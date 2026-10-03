# Recto evals on the fixture vault

Every `npm run bots:eval` on the fixture vault (`tests/bots/eval/fixture-vault`, cases in `tests/bots/eval/cases.yaml`), newest first. The runner rewrites this table; the format is described in each report ("Recto Eval Report v1").

| Date | Model | Label | recall@4 | Pass | Graded good | TTFT p50 | Report |
|---|---|---|---|---|---|---|---|
| 2026-10-03 13:29 | qwen3.5:9b | 3.3 task index, list by the harness | 80% | 87% | — | 10.2 s | [report](./2026-10-03%2013-29%20%E2%80%94%203.3%20task%20index,%20list%20by%20the%20harness/report.md) |
| 2026-10-03 13:14 | qwen3.5:9b | 3.3 task index, fixed | 75% | 79% | — | 12.9 s | [report](./2026-10-03%2013-14%20%E2%80%94%203.3%20task%20index,%20fixed/report.md) |
| 2026-10-03 13:01 | qwen3.5:9b | 3.2 router, fixed | 53% | 63% | — | 9.5 s | [report](./2026-10-03%2013-01%20%E2%80%94%203.2%20router,%20fixed/report.md) |
| 2026-10-03 12:50 | qwen3.5:9b | 3.3 task index | 45% | 58% | — | 12.4 s | [report](./2026-10-03%2012-50%20%E2%80%94%203.3%20task%20index/report.md) |
| 2026-10-03 12:38 | qwen3.5:9b | 3.2 router | 31% | 37% | — | 9.3 s | [report](./2026-10-03%2012-38%20%E2%80%94%203.2%20router/report.md) |
| 2026-10-03 12:28 | qwen3.5:9b | 3.1 speed | 28% | 42% | — | 4.7 s | [report](./2026-10-03%2012-28%20%E2%80%94%203.1%20speed/report.md) |
| 2026-10-03 12:19 | qwen3.5:9b | baseline v2 | 28% | 42% | — | 5.3 s | [report](./2026-10-03%2012-19%20%E2%80%94%20baseline%20v2/report.md) |
| 2026-10-03 10:55 | gemma4:e4b | baseline | 29% | 45% | — | 3.1 s | [report](./2026-10-03%2010-55%20%E2%80%94%20baseline/report.md) |
| 2026-10-03 10:50 | gemma4:12b | baseline | 29% | 45% | — | 7.0 s | [report](./2026-10-03%2010-50%20%E2%80%94%20baseline/report.md) |
| 2026-10-03 10:38 | qwen3.5:9b | baseline | 29% | 45% | — | 3.2 s | [report](./2026-10-03%2010-38%20%E2%80%94%20baseline/report.md) |
