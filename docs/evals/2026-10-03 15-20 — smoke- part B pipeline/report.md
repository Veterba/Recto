---
run_id: "2026-10-03 15-20 — smoke- part B pipeline"
date: 2026-10-03T13:20:31.374Z
model: qwen3.5:9b
commit: e314161 (dirty)
report_version: 1
compared_to: "2026-10-03 13-29 — 3.3 task index, list by the harness"
---

# Recto Eval: smoke: part B pipeline

## Summary

Compared to "2026-10-03 13-29 — 3.3 task index, list by the harness", what changed: the code (0bca99b → e314161, uncommitted changes), SYSTEM.md, classifier on, hybridRetrieval on, namedNotes on, scopeTools on, noteCards on, stickyContext on, steps on. 2 of 4 cases pass (50%), recall@4 75%, time to first token 19.5 s at the median (p90 21.5 s), 10.3 tokens/s. Pass rate 87% → 50%, recall@4 80% → 75%, TTFT p50 10.2 s → 19.5 s. No kind got better. Biggest regression: named-note (▼ -50 pt).

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 11.2 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"qwen3.5","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router on, classifier on, taskIndex on, looseTasks on, hybridRetrieval on, namedNotes on, scopeTools on, noteCards on, tools off, stickyContext on, steps on
- SYSTEM.md: sha256 `fc475e8d2362` (full text in config.json)
- Vault: fixture vault, 64 notes (ru 25, en 36, no 3); today = 2026-09-30
- Built before the run: chunk vectors for 64 notes (91 pieces embedded) in 7.9 s; note cards 64/64 in 323.4 s (cached cards reused)
- Cases: tests/bots/eval/cases.yaml (sha256 `464a72f230bf`)
- Machine: Apple M3, 16 GB RAM
- Code: feature/recto-rag-v1 @ e314161 with uncommitted changes, app 0.9.3

## Dataset

4 cases; questions in en 3, ru 1; 4 with an expected answer, 0 with earlier turns.

| Kind | Cases |
|---|---|
| named-note | 4 |

## Metrics

- **recall@4**: 75%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 75%. The answer names at least one expected note by title.
- **sources-correct**: 75%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: —. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: —. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 75%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self / review / advice); — before the router exists. Decided by rules 0, by the example questions 1, by the model 3.
- **ungrounded claims**: 2. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 19.5 s, p90 21.5 s — from the question to the first token, including the vault search.
- **total time** p50 25.7 s, p90 30.4 s — from the question to the last token.
- **tokens/sec**: 10.3. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.1 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.8 GB; swap used 6.0 GB before → 5.6 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| named-note | 4 | 2/4 (50%) | 75% | — | 75% | 75% | 75% | — | 2 |
| **overall** | 4 | 2/4 (50%) | 75% | — | 75% | 75% | 75% | — | 2 |

## Compared to 2026-10-03 13-29 — 3.3 task index, list by the harness

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| named-note | 4 | 2/4 (50%) ▼ -50 pt | 75% ▼ -25 pt | — | 75% | 75% | 75% ▼ -25 pt | — | 2 (was 0) |
| **overall** | 4 | 2/4 (50%) ▼ -37 pt | 75% ▼ -5 pt | — | 75% | 75% | 75% ▼ -14 pt | — | 2 (was 2) |

- pass → fail: `named-beta-feedback`, `named-deep-work`
- fail → pass: none
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| named-note | 19.5 s | 21.5 s | 25.7 s | 30.4 s | 10.3 |
| **overall** | 19.5 s | 21.5 s | 25.7 s | 30.4 s | 10.3 |

## Error analysis

- `named-deep-work` (named-note) — ignored named note: expected Deep Work; read nothing; ungrounded claim: named “Deep Work” without having it; wrong route: router said self
- `named-beta-feedback` (named-note) — ungrounded claim: named “Weekly goals” without having it

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| ignored named note | 1 |
| ungrounded claim | 2 |
| wrong route | 1 |

## Appendix: cases

### named-beta-feedback · named-note · FAIL

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **notes** by model · “Look in Beta feedback - what do testers ask for most?” · classifier: self 0.60 (margin 0.02) · en: Beta feedback · 9.3 s

**Steps:** Opened → Beta feedback · Searching notes → “2026-09-29”

**Tool calls:** —

**Notes in context:**
- Beta feedback › Beta feedback (`Projects/Lark/Beta feedback.md`, score 0.03)
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 0.03)
- 2026-09-25 — v0.8 › 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 0.03)
- 2026-09-28 — v0.9 › 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 0.03)
- 2026-09-25 › 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 0.02)
- Localise into Norwegian › Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 0.02)

**Answer:**

> In the **Beta feedback** note, 7 out of 12 testers asked about **"Weekly goals"** (specifically "three times a week" instead of daily). This is by far the most requested feature. Related notes confirm this was also noted in your log for v0.9 on 2026-09-28.
> 
> Would you like to add this to your upcoming sprint planning?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok — ungrounded claim

**Timings:** TTFT 21.5 s, total 30.4 s, search 9.4 s, 9.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · PASS

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **notes** by model · “Посмотри в Lark plan, какая платформа первая?” · classifier: notes 0.55 (margin 0.01) · en: Lark plan · 7.1 s

**Steps:** Ищу в заметках → “Lark plan”

**Tool calls:** —

**Notes in context:**
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 0.02)
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 0.02)
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.02)

**Answer:**

> Первой платформой для **Lark** является **iOS**. Приложение строится на SwiftUI, а версия для Android планируется только после выхода 1.0-й версии (при условии наличия как минимум 1 000 еженедельных пользователей). Это решение зафиксировано в разделе "Platform" заметки [[Lark plan]].
> 
> Хотите обсудить стратегию запуска на iOS или приоритеты разработки виджетов?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 19.5 s, total 28.7 s, search 7.1 s, 10.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** by model · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · classifier: self 0.53 (margin 0.04) · en: sourdough starter · ru: закваска для хлеба · named: [[Sourdough starter (old)]] · 8.7 s

**Steps:** Opened → Sourdough starter (old) · Opened → Apartment move checklist · Searching notes → “Sourdough starter”

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.03)
- Apartment move checklist › Apartment move checklist (`Home/Apartment move checklist.md`, score 1.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 0.03)
- Bike maintenance manual › Bike maintenance manual > Cassette (`Long/Bike maintenance manual.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Saddle and bars (`Long/Bike maintenance manual.md`, score 0.02)

**Answer:**

> You used a **1:1:1** ratio with only white flour in your old routine. That method resulted in bread that was too sour and peaked in just 3 hours, which is why you switched to the current setup.

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 21.2 s, total 25.7 s, search 8.7 s, 10.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · FAIL

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** **self** by embedding · “In Deep Work, how many hours of deep work a day did I aim for?” · classifier: self 0.60 (margin 0.05) · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I didn't find any note in your vault that mentions specific hour targets from *Deep Work*. You might have written it down elsewhere or not yet recorded this goal. Do you recall roughly what timeframe or context was associated with that number when you wrote it?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — ignored named note, ungrounded claim, wrong route

**Timings:** TTFT 4.6 s, total 9.5 s, search 0.0 s, 10.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
