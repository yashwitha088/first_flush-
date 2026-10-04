# FirstFlush India

FirstFlush India is a pre-rain runoff-risk decision-support platform. It ranks drainage points that deserve attention before rainfall using transparent, relative scoring. It does **not** measure laboratory pollutant concentrations, guarantee flood prevention, or claim complete nationwide drain coverage.

## Local run

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
npm test
npm run lint
npm run build
npm start
```

Open `http://localhost:8787`.

The default adapter is local JSON storage. Runtime state is written to `data/runtime.json` and uploaded evidence to `uploads/`; both are ignored by Git. Use `npm install` on a clean checkout. A lockfile can be generated with `npm install --package-lock-only` after reviewing dependencies.

## Implemented workflow

1. Open the command center.
2. Review weather mode and freshness.
3. Inspect the ranked queue and map/list view.
4. Open a location to view factors, provenance, evidence, and recommended action.
5. Submit an observation with optional photos.
6. Review and verify/reject pending observations.
7. Create an intervention, assign it, update status, and attach evidence.
8. Ask the grounded Copilot for an explanation or field briefing.
9. Export CSV or JSON reports.

## Data honesty

Weather is labeled `live`, `cached`, `fallback`, or `offline`. Location coverage is labeled `Verified`, `Community reported`, `Estimated`, or `Limited data`. Observation verification is `Pending`, `Verified`, or `Rejected`. The seed records are demo records, not an official national inventory.

## AWS boundary

`amplify.yml` builds the static frontend and `template.yaml` provides an optional SAM API deployment skeleton. The default implementation uses local JSON storage; it must not be described as DynamoDB/S3 persistence until cloud adapters, IAM, and deployment have been configured and tested.

## Safety

Physical drain work, temporary screens, diversion, and sampling must only be performed by trained or authorized personnel. FirstFlush prioritizes decisions; it does not physically control infrastructure.
