# FirstFlush India

FirstFlush India is a decision-support platform that helps environmental teams prioritize urban drainage points before rainfall. It estimates **relative first-flush runoff risk**; it does not measure laboratory pollutant concentrations or claim complete national drain coverage.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env
npm test
npm run lint
npm run build
npm start
```

Open http://localhost:8787.

## Main capabilities

- Ranked pre-rain priority queue with explainable deterministic scoring.
- Open-Meteo live weather with explicit live, cached, fallback, stale, and offline states.
- Real Leaflet map with accessible list fallback.
- Field observations with validated image evidence and pending verification.
- Verification workflow for observations.
- Action tracker with assignment, priorities, due windows, evidence, and lifecycle history.
- Server-Sent Events plus polling fallback.
- Grounded local Copilot with no AI key dependency.
- CSV and briefing reports.
- Local JSON adapter for a reliable demo; cloud services are not falsely represented as active.

## Honest boundaries

The repository ships with limited, clearly labeled demo locations. Local mode persists to `data/runtime.json` and `uploads/`. Production AWS persistence, authentication, and IMD access require configuration and are not implied by the local demo.

Physical drain work and sampling must only be performed by authorized or trained personnel.

## API

`GET /api/health`, `GET /api/state`, `GET /api/locations`, `GET /api/weather`, `GET /api/events`, `POST /api/observations`, `GET /api/observations`, `PATCH /api/observations/:id/verify`, `POST /api/actions`, `GET /api/actions`, `PATCH /api/actions/:id`, `POST /api/actions/:id/evidence`, `POST /api/chat`, `GET /api/report.csv`, `GET /api/report.json`, `GET /api/methodology`.

## AWS boundary

`amplify.yml` builds the static frontend. `template.yaml` provides an optional SAM API deployment. The default application uses local JSON storage. Do not claim DynamoDB/S3 persistence until adapters, IAM, and deployment configuration are added and tested.
