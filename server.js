import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import serverless from 'serverless-http';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8787);
const runtimePath = path.resolve(process.env.FIRSTFLUSH_RUNTIME_FILE || path.join(root, 'data/runtime.json'));
const seedPath = path.resolve(process.env.FIRSTFLUSH_SEED_FILE || path.join(root, 'data/locations.json'));
const uploadDir = path.resolve(process.env.FIRSTFLUSH_UPLOAD_DIR || path.join(root, 'uploads'));
const now = () => new Date();
const iso = () => now().toISOString();
const id = () => crypto.randomUUID();
const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));
const weights = Object.freeze({ dryPeriod: 0.22, rainfall: 0.22, pavedSurface: 0.14, traffic: 0.12, construction: 0.10, waste: 0.08, blockage: 0.07, waterBodyProximity: 0.05 });
const actionTypes = ['Inspect', 'Clean', 'Temporary screen/diversion', 'Collect water sample', 'Monitor', 'Verify completed action'];
const actionStatuses = ['Pending', 'Assigned', 'In progress', 'Completed', 'Verified', 'Rejected'];
const observationTypes = ['Blocked drain', 'Litter accumulation', 'Oil or sheen observed', 'Construction sediment', 'Animal waste', 'Drain overflow', 'Water-body inflow', 'Clean/clear', 'Unknown condition'];
const coverageLevels = ['Verified', 'Community reported', 'Estimated', 'Limited data'];
const verificationStates = ['Pending', 'Verified', 'Rejected'];

fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
let db = fs.existsSync(runtimePath)
  ? JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
  : { locations: seed, observations: [], actions: [], events: [], weather: {}, updatedAt: iso() };
db.locations ??= seed; db.observations ??= []; db.actions ??= []; db.events ??= []; db.weather ??= {};
const clients = new Set();
const rateBuckets = new Map();

function persist() {
  db.updatedAt = iso();
  fs.writeFileSync(runtimePath, JSON.stringify(db, null, 2));
}

function emit(type, payload = {}) {
  const event = { id: id(), type, at: iso(), payload };
  db.events.unshift(event);
  db.events = db.events.slice(0, 250);
  persist();
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try { client.write(message); } catch { clients.delete(client); }
  }
}

function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
  const max = Number(process.env.RATE_LIMIT_MAX || 120);
  const current = rateBuckets.get(key) || { started: Date.now(), count: 0 };
  if (Date.now() - current.started > windowMs) { current.started = Date.now(); current.count = 0; }
  current.count += 1; rateBuckets.set(key, current);
  if (current.count > max) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  return next();
}

function validIndianCoordinates(lat, lon) {
  return Number.isFinite(Number(lat)) && Number(lat) >= 6 && Number(lat) <= 38 && Number(lon) >= 68 && Number(lon) <= 98;
}

function scoreWaterBody(distance) {
  const meters = Number(distance);
  if (!Number.isFinite(meters)) return 15;
  if (meters <= 50) return 100; if (meters <= 100) return 90; if (meters <= 250) return 75;
  if (meters <= 500) return 55; if (meters <= 1000) return 35; return 15;
}

function scoreRainfall(weather) {
  const amount = clamp((Number(weather?.rainfallAmount) || 0) * 4);
  return amount * 0.45 + clamp(weather?.rainfallIntensity) * 0.35 + clamp(weather?.rainfallProbability) * 0.20;
}

function levelFor(score) { return score >= 75 ? 'Very high' : score >= 50 ? 'High' : score >= 25 ? 'Moderate' : 'Low'; }

function confidenceFor(location, observations, weather) {
  let score = location.coverage === 'Verified' ? 35 : location.coverage === 'Community reported' ? 25 : location.coverage === 'Estimated' ? 15 : 8;
  if (weather?.mode === 'live') score += 30; else if (weather?.mode === 'cached') score += 20; else if (weather?.mode === 'fallback') score += 8;
  if (observations.length >= 2) score += 25; else if (observations.length === 1) score += 15;
  if (location.waterBodyVerified) score += 10;
  return { score: clamp(score), level: score >= 75 ? 'High' : score >= 50 ? 'Medium' : 'Low' };
}

function calculateRisk(location, weather = null) {
  const observations = db.observations.filter(item => item.locationId === location.id && item.verification !== 'Rejected');
  const latest = [...observations].sort((a, b) => new Date(b.observedAt || 0) - new Date(a.observedAt || 0))[0];
  const factors = {
    dryPeriod: clamp(Number(location.dryDays) * 5.55),
    rainfall: scoreRainfall(weather),
    pavedSurface: clamp(location.paved), traffic: clamp(location.traffic), construction: clamp(location.construction),
    waste: clamp(Math.max(Number(location.waste) || 0, latest?.visibleLitter ? 60 : 0, latest?.oilResidue ? 75 : 0, latest?.constructionSediment ? 55 : 0, latest?.animalWaste ? 45 : 0)),
    blockage: clamp(Math.max(Number(location.blockage) || 0, Number(latest?.blockageLevel) || 0)),
    waterBodyProximity: scoreWaterBody(location.distanceToWaterBody)
  };
  const riskScore = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + factors[key] * weight, 0));
  const level = levelFor(riskScore);
  const confidence = confidenceFor(location, observations, weather);
  const reasons = [];
  if (factors.dryPeriod >= 70) reasons.push(`${location.dryDays} dry days`);
  if (factors.rainfall >= 70) reasons.push('substantial forecast rainfall');
  if (factors.pavedSurface >= 70) reasons.push('large paved catchment');
  if (factors.traffic >= 70) reasons.push('high traffic exposure');
  if (factors.construction >= 60) reasons.push('construction exposure');
  if (factors.waste >= 55) reasons.push('waste exposure');
  if (factors.blockage >= 55) reasons.push('blockage/debris evidence');
  if (factors.waterBodyProximity >= 70) reasons.push('close water-body connection');
  const activeAction = db.actions.find(action => action.locationId === location.id && !['Verified', 'Rejected'].includes(action.status));
  return {
    ...location, riskScore, level, confidence: confidence.level, confidenceScore: confidence.score, factors,
    reason: `${location.name} is ${level.toLowerCase()} priority because of ${reasons.join(', ') || 'limited available evidence'}.`,
    recommendation: level === 'Very high' ? 'Inspect and clear visible debris before rainfall; use a temporary screen only if safe and permitted.' : level === 'High' ? 'Schedule an inspection and prepare a cleanup action before rainfall.' : level === 'Moderate' ? 'Monitor and verify the latest field condition before rainfall.' : 'Continue monitoring and record an observation if conditions change.',
    evidenceFreshness: latest ? `${Math.max(0, Math.round((Date.now() - new Date(latest.observedAt).getTime()) / 3600000))}h old` : 'No recent evidence',
    weatherStatus: weather?.mode || 'offline', weatherProvider: weather?.provider || 'Unavailable', weatherUpdatedAt: weather?.updatedAt || null,
    interventionStatus: activeAction?.status || location.interventionStatus || 'No active intervention', calculatedAt: iso()
  };
}

async function getWeather(lat, lon) {
  if (!validIndianCoordinates(lat, lon)) return { mode: 'offline', provider: 'Unavailable', error: 'Use an Indian latitude and longitude.' };
  const key = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  const cached = db.weather[key];
  try {
    const base = process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com/v1/forecast';
    const response = await fetch(`${base}?latitude=${lat}&longitude=${lon}&hourly=precipitation,precipitation_probability,rain&forecast_days=1&timezone=auto`);
    if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
    const data = await response.json();
    const precipitation = Array.isArray(data.hourly?.precipitation) ? data.hourly.precipitation.slice(0, 6) : [];
    const probability = Array.isArray(data.hourly?.precipitation_probability) ? data.hourly.precipitation_probability.slice(0, 6) : [];
    const result = { mode: 'live', provider: 'Open-Meteo', updatedAt: iso(), rainfallAmount: Number(Math.max(...precipitation, 0).toFixed(1)), rainfallIntensity: clamp(Math.max(...precipitation, 0) * 8), rainfallProbability: Math.max(...probability, 0), forecastWindow: 'next 6 hours', timezone: data.timezone || 'local' };
    db.weather[key] = result; persist(); emit('weather.updated', result); return result;
  } catch (error) {
    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt).getTime();
      return { ...cached, mode: 'cached', ageMs, stale: ageMs > Number(process.env.WEATHER_STALE_MS || 3600000), note: 'Last successful provider result; not live.' };
    }
    return { mode: 'fallback', provider: 'Local scenario', updatedAt: iso(), rainfallAmount: 18, rainfallIntensity: 70, rainfallProbability: 70, forecastWindow: 'demo fallback', stale: true, note: 'Weather provider unavailable; this value is not live.', error: clean(error.message, 200) };
  }
}

const origins = String(process.env.CORS_ORIGINS || 'http://localhost:8787').split(',').map(value => value.trim()).filter(Boolean);
app.use(cors({ origin: (origin, callback) => !origin || origins.includes('*') || origins.includes(origin) ? callback(null, true) : callback(new Error('CORS origin denied')) }));
app.use(rateLimit); app.use(express.json({ limit: '1mb' })); app.use(express.static(path.join(root, 'public'))); app.use('/uploads', express.static(uploadDir));
const upload = multer({ dest: uploadDir, limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 5242880), files: Number(process.env.MAX_UPLOAD_FILES || 3) }, fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'firstflush-api', mode: 'local-json-adapter', updatedAt: db.updatedAt }));
app.get('/api/system', (_req, res) => res.json({ mode: 'local', storage: 'JSON file', coverage: 'Limited demo records', weatherProvider: 'Open-Meteo with cached/fallback states', updatedAt: db.updatedAt, recentEvents: db.events.slice(0, 20) }));
app.get('/api/methodology', (_req, res) => res.json({ weights, levels: { Low: '0-24', Moderate: '25-49', High: '50-74', 'Very high': '75-100' }, disclaimer: 'Relative prioritization estimate; not laboratory pollution measurement.' }));
app.get('/api/locations', (_req, res) => res.json(db.locations));
app.get('/api/weather', async (req, res) => res.json(await getWeather(Number(req.query.lat || 20.5937), Number(req.query.lon || 78.9629))));
app.get('/api/state', async (req, res) => {
  const first = db.locations[0]; const weather = await getWeather(Number(req.query.lat || first?.lat || 20.5937), Number(req.query.lon || first?.lon || 78.9629));
  const locations = db.locations.filter(item => (!req.query.state || req.query.state === 'All' || item.state === req.query.state) && (!req.query.city || req.query.city === 'All' || item.city === req.query.city)).map(item => calculateRisk(item, weather)).sort((a, b) => b.riskScore - a.riskScore).map((item, index) => ({ ...item, rank: index + 1 }));
  res.json({ locations, observations: db.observations, actions: db.actions, weather, updatedAt: db.updatedAt, coverage: 'Partial; seed and user-submitted records are labeled.' });
});
app.get('/api/events', (req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.(); res.write(`event: connected\ndata: ${JSON.stringify({ at: iso() })}\n\n`); clients.add(res); const heartbeat = setInterval(() => { try { res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: iso() })}\n\n`); } catch { clearInterval(heartbeat); clients.delete(res); } }, 20000); req.on('close', () => { clearInterval(heartbeat); clients.delete(res); }); });
app.get('/api/observations', (_req, res) => res.json(db.observations));
app.post('/api/observations', upload.array('photos', 3), (req, res) => {
  const body = req.body || {}; const location = db.locations.find(item => item.id === clean(body.locationId, 120)); const lat = Number(body.lat ?? location?.lat); const lon = Number(body.lon ?? location?.lon);
  if (!location || !observationTypes.includes(clean(body.type, 80)) || !validIndianCoordinates(lat, lon)) return res.status(400).json({ error: 'Valid location, supported observation type, and Indian coordinates are required.' });
  const observedAt = new Date(body.observedAt || Date.now()); if (Number.isNaN(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300000) return res.status(400).json({ error: 'Observation timestamp is invalid or in the future.' });
  const coverage = clean(body.coverage || 'Community reported', 40); if (!coverageLevels.includes(coverage)) return res.status(400).json({ error: 'Unsupported coverage level.' });
  if (db.observations.some(item => item.locationId === location.id && item.type === clean(body.type, 80) && Date.now() - new Date(item.observedAt).getTime() < 3600000)) return res.status(409).json({ error: 'A similar observation was submitted within the last hour.' });
  const observation = { id: id(), locationId: location.id, type: clean(body.type, 80), severity: clean(body.severity || 'moderate', 20), lat, lon, blockageLevel: clamp(body.blockageLevel), visibleLitter: body.visibleLitter === 'true', oilResidue: body.oilResidue === 'true', constructionSediment: body.constructionSediment === 'true', animalWaste: body.animalWaste === 'true', trafficExposure: clamp(body.trafficExposure), waterBodyConnection: body.waterBodyConnection === 'true', notes: clean(body.notes, 2000), observedAt: observedAt.toISOString(), submittedAt: iso(), source: clean(body.source || 'User-submitted', 80), coverage, verification: 'Pending', photos: (req.files || []).map(file => `/uploads/${file.filename}`) };
  db.observations.unshift(observation); persist(); emit('observation.created', observation); emit('risk.recalculated', { locationId: location.id }); res.status(201).json(observation);
});
app.patch('/api/observations/:id/verify', (req, res) => { const observation = db.observations.find(item => item.id === req.params.id); if (!observation) return res.status(404).json({ error: 'Observation not found.' }); const verification = clean(req.body?.verification, 20); if (!verificationStates.includes(verification) || verification === 'Pending') return res.status(400).json({ error: 'Verification must be Verified or Rejected.' }); observation.verification = verification; observation.reviewer = clean(req.body?.reviewer || 'Operator', 100); observation.verificationComment = clean(req.body?.comment, 1000); observation.verifiedAt = iso(); persist(); emit('observation.verified', observation); emit('risk.recalculated', { locationId: observation.locationId }); res.json(observation); });
app.get('/api/actions', (_req, res) => res.json(db.actions));
app.post('/api/actions', (req, res) => { const body = req.body || {}; const location = db.locations.find(item => item.id === clean(body.locationId, 120)); const type = clean(body.type, 100); if (!location || !actionTypes.includes(type)) return res.status(400).json({ error: 'Valid location and supported action type are required.' }); const priority = clean(body.priority || 'High', 20); if (!['Low', 'Medium', 'High', 'Critical'].includes(priority)) return res.status(400).json({ error: 'Unsupported priority.' }); const action = { id: id(), locationId: location.id, type, priority, status: 'Pending', assignee: clean(body.assignee, 120), dueBefore: body.dueBefore ? new Date(body.dueBefore).toISOString() : null, notes: clean(body.notes, 2000), evidence: [], history: [{ status: 'Pending', at: iso() }], createdAt: iso(), updatedAt: iso() }; db.actions.unshift(action); persist(); emit('action.updated', action); res.status(201).json(action); });
app.patch('/api/actions/:id', (req, res) => { const action = db.actions.find(item => item.id === req.params.id); if (!action) return res.status(404).json({ error: 'Action not found.' }); const status = clean(req.body?.status, 40); if (status && !actionStatuses.includes(status)) return res.status(400).json({ error: 'Unsupported action status.' }); if (status && status !== action.status) { action.status = status; action.history.push({ status, at: iso(), comment: clean(req.body?.comment, 500) }); if (status === 'Completed') action.completedAt = iso(); } if (req.body?.assignee !== undefined) action.assignee = clean(req.body.assignee, 120); action.updatedAt = iso(); persist(); emit('action.updated', action); res.json(action); });
app.post('/api/actions/:id/evidence', upload.array('photos', 3), (req, res) => { const action = db.actions.find(item => item.id === req.params.id); if (!action) return res.status(404).json({ error: 'Action not found.' }); action.evidence.push(...(req.files || []).map(file => ({ url: `/uploads/${file.filename}`, kind: clean(req.body?.kind || 'after', 30), note: clean(req.body?.note, 500), at: iso() }))); action.updatedAt = iso(); persist(); emit('action.updated', action); res.json(action); });

app.post('/api/chat', (req, res) => {
  const query = clean(req.body?.message, 500).toLowerCase(); const locations = db.locations.map(item => calculateRisk(item, null)).sort((a, b) => b.riskScore - a.riskScore); const top = locations[0]; let answer;
  const stateMatch = db.locations.find(item => query.includes(item.state.toLowerCase()));
  if (query.includes('pending') && query.includes('verif')) answer = `${db.observations.filter(item => item.verification === 'Pending').length} observation(s) are pending verification.`;
  else if (query.includes('brief')) answer = `Field briefing: prioritize ${locations.slice(0, 3).map(item => `${item.name} (${item.riskScore}/100)`).join(', ')}. Confirm weather mode before dispatch and record completion evidence.`;
  else if (stateMatch) { const stateLocations = locations.filter(item => item.state === stateMatch.state); answer = `${stateMatch.state} has ${stateLocations.length} monitored location(s): ${stateLocations.map(item => `${item.name} (${item.riskScore}/100)`).join(', ')}.`; }
  else { const selected = locations.find(item => query.includes(item.id.toLowerCase()) || query.includes(item.name.toLowerCase())) || top; answer = `${selected.name} has an estimated relative risk of ${selected.riskScore}/100 (${selected.level}) with ${selected.confidence} confidence. ${selected.reason} Recommended action: ${selected.recommendation} This is not a laboratory contamination result.`; }
  res.json({ answer, mode: 'local-grounded', source: 'Current application data' });
});

const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
app.get('/api/report.csv', (_req, res) => { const rows = db.locations.map(item => calculateRisk(item, null)).sort((a, b) => b.riskScore - a.riskScore); const csv = ['rank,name,city,state,riskScore,level,confidence,coverage,evidenceFreshness,recommendation', ...rows.map((item, index) => [index + 1, item.name, item.city, item.state, item.riskScore, item.level, item.confidence, item.coverage, item.evidenceFreshness, item.recommendation].map(quote).join(','))].join('\n'); res.type('text/csv').set('Content-Disposition', 'attachment; filename="firstflush-priority.csv"').send(csv); });
app.get('/api/report.json', (_req, res) => res.json({ generatedAt: iso(), disclaimer: 'Relative prioritization estimate; not laboratory pollution measurement.', locations: db.locations.map(item => calculateRisk(item, null)), observations: db.observations, actions: db.actions }));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'public/index.html')));
app.use((error, _req, res, _next) => { if (error?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Uploaded file is too large.' }); if (error?.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files.' }); if (error?.message === 'CORS origin denied') return res.status(403).json({ error: 'Origin not allowed.' }); if (error?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected upload field.' }); console.error(error); return res.status(500).json({ error: 'Request could not be processed.' }); });

export { app, calculateRisk, weights };
export const handler = serverless(app);
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) app.listen(port, () => console.log(`FirstFlush India running at http://localhost:${port}`));
