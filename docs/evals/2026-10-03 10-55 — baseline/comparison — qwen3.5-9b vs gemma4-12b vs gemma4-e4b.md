# Recto Eval comparison: qwen3.5:9b · baseline vs gemma4:12b · baseline vs gemma4:e4b · baseline

Runs: "2026-10-03 10-38 — baseline" (qwen3.5:9b, b02b0ea), "2026-10-03 10-50 — baseline" (gemma4:12b, b02b0ea), "2026-10-03 10-55 — baseline" (gemma4:e4b, b02b0ea).
All on the same cases.

## Quality per kind (pass · recall@4)

| Kind | qwen3.5:9b · baseline | gemma4:12b · baseline | gemma4:e4b · baseline |
|---|---|---|---|
| same-language | 4/6 · 67% | 4/6 · 67% | 4/6 · 67% |
| cross-language | 0/6 · 0% | 0/6 · 0% | 0/6 · 0% |
| named-note | 2/4 · 50% | 2/4 · 50% | 2/4 · 50% |
| follow-up | 1/2 · 50% | 1/2 · 50% | 1/2 · 50% |
| recent | 0/3 · 0% | 0/3 · 0% | 0/3 · 0% |
| tasks | 0/3 · 0% | 0/3 · 0% | 0/3 · 0% |
| not-in-vault | 3/3 · — | 3/3 · — | 3/3 · — |
| small-talk | 3/3 · — | 3/3 · — | 3/3 · — |
| self | 2/3 · — | 2/3 · — | 2/3 · — |
| **overall** | 15/33 · 29% | 15/33 · 29% | 15/33 · 29% |

## Speed, memory, grades

| | qwen3.5:9b · baseline | gemma4:12b · baseline | gemma4:e4b · baseline |
|---|---|---|---|
| TTFT p50 / p90 | 3.2 s / 6.5 s | 7.0 s / 25.7 s | 3.1 s / 7.5 s |
| Total p50 / p90 | 6.2 s / 11.6 s | 15.5 s / 36.4 s | 6.1 s / 15.5 s |
| Tokens/s | 13.2 | 4.6 | 7.8 |
| Model size by Ollama's count (low for gemma4) | 5.7 GB | 1.0 GB | 0.3 GB |
| Peak resident: Ollama / app | 7.1 GB / 0.4 GB | 9.4 GB / 0.4 GB | 7.0 GB / 0.4 GB |
| Swap used before → after | 6.1 GB → 6.1 GB | 6.1 GB → 6.6 GB | 6.6 GB → 5.7 GB |
| macOS started swapping more | no | yes (+0.5 GB) | no |
| Tool call / JSON parse failures | — (no router or tools yet) | — (no router or tools yet) | — (no router or tools yet) |
| My grades (good of graded) | — | — | — |

## Per case

| Case | Kind | qwen3.5:9b · baseline | gemma4:12b · baseline | gemma4:e4b · baseline |
|---|---|---|---|---|
| `same-sourdough-ratio` | same-language | PASS | PASS | PASS |
| `same-half-marathon` | same-language | PASS | PASS | PASS |
| `same-chain-wear` | same-language | PASS | PASS | PASS |
| `same-ru-emergency-fund` | same-language | PASS | PASS | PASS |
| `same-ru-sleep` | same-language | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `same-no-course` | same-language | FAIL (wrong note) | FAIL (wrong note) | FAIL (wrong note) |
| `cross-ru-en-notifications` | cross-language | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `cross-ru-en-sourdough` | cross-language | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `cross-ru-en-marathon` | cross-language | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `cross-en-ru-borscht` | cross-language | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `cross-en-ru-kitchen` | cross-language | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `cross-en-ru-monetisation` | cross-language | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `named-beta-feedback` | named-note | FAIL (ignored named note) | FAIL (ignored named note) | FAIL (ignored named note) |
| `named-ru-plan-platform` | named-note | FAIL (ignored named note) | FAIL (ignored named note) | FAIL (ignored named note) |
| `named-old-starter` | named-note | PASS | PASS | PASS |
| `named-deep-work` | named-note | PASS | PASS | PASS |
| `follow-notifications-where` | follow-up | FAIL (wrong note) | FAIL (wrong note) | FAIL (wrong note) |
| `follow-ru-tbilisi-food` | follow-up | PASS | PASS | PASS |
| `recent-last-week` | recent | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `recent-wednesday` | recent | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `recent-ru-since-monday` | recent | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `tasks-open-last-week` | tasks | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `tasks-done` | tasks | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `tasks-ru-overdue` | tasks | FAIL (retrieval miss) | FAIL (retrieval miss) | FAIL (retrieval miss) |
| `notin-australia` | not-in-vault | PASS | PASS | PASS |
| `notin-japan` | not-in-vault | PASS | PASS | PASS |
| `notin-ru-netflix` | not-in-vault | PASS | PASS | PASS |
| `talk-hi` | small-talk | PASS | PASS | PASS |
| `talk-ru-thanks` | small-talk | PASS | PASS | PASS |
| `talk-nice` | small-talk | PASS | PASS | PASS |
| `self-model` | self | FAIL (unneeded retrieval) | FAIL (unneeded retrieval) | FAIL (unneeded retrieval) |
| `self-ru-knowledge-year` | self | PASS | PASS | PASS |
| `self-privacy` | self | PASS | PASS | PASS |


## Read by hand

Retrieval is the same code for all three, so pass/fail is identical (15/33): every model gets the
same notes, and the cases fail where the search finds nothing (cross-language, recent, tasks). What
differs is what each model does with them.

Russian answers (emergency fund, sleep, Lark notifications, Tbilisi follow-up, thanks, knowledge
year, Netflix, overdue tasks, "look in Lark plan"):

- **qwen3.5:9b** reads the most natural: "Вам необходимо накопить 540 000 рублей… Хотите,
  подсчитаю остаток?", the Tbilisi answer is a clean list. Translated in places: "из каких лет
  состоят мои знания", "сохранить эту мысль". Always formal "вы".
- **gemma4:12b** is correct and short, but sounds translated more often: "В предоставленных записях
  нет информации" (exactly the "provided to you" phrase to avoid), "Есть ли у вас записи о вашем
  режиме дня" (English-style possessives). Repeats the source in brackets after each sentence.
- **gemma4:e4b** is the most robotic: "Нет записей в хранилище, отвечающих на этот вопрос" (a calque
  of "no records that answer this question"), answers "Спасибо, очень помог!" with "Что именно вам
  помогло?", and cites file paths with ".md ›" in the sentence.

Honesty when the search found nothing (17 cases with a miss): qwen3.5:9b described what "Lark plan"
says without having read it ("документ содержит только общие принципы…"), and in the throttled run
before this one it invented a whole note with an ID and a date. Neither gemma model made anything up;
both said plainly that the notes don't have it. (All three answered "named-beta-feedback" correctly
from the v0.9 log, which also has the fact.)

Speed and memory on this 16 GB M3: qwen3.5:9b is the fastest (13 tokens/s, TTFT p50 3.2 s);
gemma4:e4b starts as fast but writes at 8 tokens/s; gemma4:12b is slow (4.6 tokens/s, TTFT p90
26 s), peaks at 9.4 GB resident and pushed macOS into another 0.5 GB of swap.
