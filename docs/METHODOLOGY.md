# FirstFlush India methodology

FirstFlush India estimates relative first-flush runoff priority before rainfall. It does not measure contamination in a laboratory.

## Risk weights

| Factor | Weight |
|---|---:|
| Dry-period accumulation | 0.22 |
| Rainfall | 0.22 |
| Paved surface | 0.14 |
| Traffic exposure | 0.12 |
| Construction exposure | 0.10 |
| Waste exposure | 0.08 |
| Blockage exposure | 0.07 |
| Water-body proximity | 0.05 |

Inputs are normalized to a 0–100 range and combined into a score from 0–100.

## Score labels

| Score | Level |
|---:|---|
| 0–24 | Low |
| 25–49 | Moderate |
| 50–74 | High |
| 75–100 | Very high |

## Confidence

Confidence reflects:

- coverage/source quality;
- weather availability;
- weather freshness;
- observation availability;
- water-body verification;
- coordinate quality.

Confidence is not a probability that pollution exists.

## Weather states

- `live`: successfully fetched from Open-Meteo.
- `cached`: previous successful provider result.
- `fallback`: local scenario used when no cache exists.
- `offline`: coordinates are invalid or weather is unavailable.

## Coverage states

- `Verified`
- `Community reported`
- `Estimated`
- `Limited data`

The included locations are demo records and are not an official national drain inventory.

## Safety

Recommended interventions are decision support only. Drain work, temporary screens, diversion, and sampling require authorization, training, and local safety procedures.