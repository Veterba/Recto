Every eval run, newest first. Wider than the text column on purpose.

| Run | Model | Vault | Pass | recall@4 | TTFT p50 | Tokens/s | Report |
|---|---|---|---|---|---|---|---|
| 2026-10-03 18-38 — B final | qwen3.5:9b | fixture | 38/38 (100%) | 96% | 6.8 s | 7.0 | [[Garden/Soil\|report]] |
| 2026-10-03 17-53 — B final | qwen3.5:9b | vault copy | 9/10 (90%) | 72% | 17.1 s | 7.4 | [[Kitchen/Sourdough|report]] |
| 2026-10-03 13-29 — 3.3 task index, list by the harness | qwen3.5:9b | fixture | 33/38 (87%) | 80% | 10.2 s | 7.3 | [[Handbook]] |
| 2026-10-03 10-55 — baseline | gemma4:e4b | fixture | 15/33 (45%) | 29% | 3.1 s | 7.8 | `docs/evals/2026-10-03-10-55-baseline/comparison-qwen3.5-9b-vs-gemma4-12b-vs-gemma4-e4b.md` |
| 2026-10-03 10-50 — baseline | gemma4:12b | fixture | 15/33 (45%) | 29% | 7.0 s | 4.6 | **slow**, tight on memory: +0.5 GB swap |

| Short | Table |
|:---|---:|
| left | 1 |
