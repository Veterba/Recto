# Recto evals on the fixture vault

Every `npm run bots:eval` on the fixture vault (`tests/bots/eval/fixture-vault`, cases in `tests/bots/eval/cases.yaml`), newest first. The runner rewrites this table; the format is described in each report ("Recto Eval Report v1").

| Date | Model | Label | recall@4 | Pass | Graded good | TTFT p50 | Report |
|---|---|---|---|---|---|---|---|
| 2026-10-03 10:55 | gemma4:e4b | baseline | 29% | 45% | — | 3.1 s | [report](./2026-10-03%2010-55%20%E2%80%94%20baseline/report.md) |
| 2026-10-03 10:50 | gemma4:12b | baseline | 29% | 45% | — | 7.0 s | [report](./2026-10-03%2010-50%20%E2%80%94%20baseline/report.md) |
| 2026-10-03 10:38 | qwen3.5:9b | baseline | 29% | 45% | — | 3.2 s | [report](./2026-10-03%2010-38%20%E2%80%94%20baseline/report.md) |
