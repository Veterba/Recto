# Recto evals on the fixture vault

Every `npm run bots:eval` on the fixture vault (`tests/bots/eval/fixture-vault`, cases in `tests/bots/eval/cases.yaml`), newest first. The runner rewrites this table; the format is described in each report ("Recto Eval Report v1").

| Date | Model | Label | recall@4 | Pass | Graded good | TTFT p50 | Report |
|---|---|---|---|---|---|---|---|
| 2026-10-03 20:00 | qwen3.5:9b | B staged check | 96% | 100% | — | 5.9 s | [report](./2026-10-03%2020-00%20%E2%80%94%20B%20staged%20check/report.md) |
| 2026-10-03 18:38 | qwen3.5:9b | B final | 96% | 100% | — | 6.8 s | [report](./2026-10-03%2018-38%20%E2%80%94%20B%20final/report.md) |
| 2026-10-03 18:24 | qwen3.5:9b | B tools on | 96% | 97% | — | 8.6 s | [report](./2026-10-03%2018-24%20%E2%80%94%20B%20tools%20on/report.md) |
| 2026-10-03 17:09 | qwen3.5:9b | B third | 96% | 100% | — | 6.5 s | [report](./2026-10-03%2017-09%20%E2%80%94%20B%20third/report.md) |
| 2026-10-03 16:40 | qwen3.5:9b | B second | 89% | 92% | — | 16.5 s | [report](./2026-10-03%2016-40%20%E2%80%94%20B%20second/report.md) |
| 2026-10-03 15:31 | qwen3.5:9b | B first: hybrid, names, classifier, scope tools | 85% | 89% | — | 4.5 s | [report](./2026-10-03%2015-31%20%E2%80%94%20B%20first-%20hybrid,%20names,%20classifier,%20scope%20tools/report.md) |
| 2026-10-03 15:20 | qwen3.5:9b | smoke: part B pipeline | 75% | 50% | — | 19.5 s | [report](./2026-10-03%2015-20%20%E2%80%94%20smoke-%20part%20B%20pipeline/report.md) |
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
