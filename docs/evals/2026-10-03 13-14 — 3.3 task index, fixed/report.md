---
run_id: "2026-10-03 13-14 — 3.3 task index, fixed"
date: 2026-10-03T11:14:35.047Z
model: qwen3.5:9b
commit: 0bca99b (dirty)
report_version: 1
compared_to: "2026-10-03 13-01 — 3.2 router, fixed"
---

# Recto Eval: 3.3 task index, fixed

## Summary

Compared to "2026-10-03 13-01 — 3.2 router, fixed", what changed: taskIndex on, looseTasks on. 30 of 38 cases pass (79%), recall@4 75%, time to first token 12.9 s at the median (p90 18.9 s), 6.9 tokens/s. Pass rate 63% → 79%, recall@4 53% → 75%, TTFT p50 9.5 s → 12.9 s. Biggest win: tasks (▲ +71 pt). No kind got worse.

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 7.7 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"qwen3.5","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router on, taskIndex on, looseTasks on, hybridRetrieval off, namedNotes off, tools off, stickyContext off, steps off
- SYSTEM.md: sha256 `70c6d0884cf0` (full text in config.json)
- Vault: fixture vault, 64 notes (ru 25, en 36, no 3); today = 2026-09-30
- Cases: tests/bots/eval/cases.yaml (sha256 `464a72f230bf`)
- Machine: Apple M3, 16 GB RAM
- Code: feature/recto-rag-v1 @ 0bca99b with uncommitted changes, app 0.9.3

## Dataset

38 cases; questions in en 23, ru 14, no 1; 35 with an expected answer, 2 with earlier turns.

| Kind | Cases |
|---|---|
| same-language | 6 |
| cross-language | 6 |
| named-note | 4 |
| follow-up | 2 |
| recent | 4 |
| tasks | 7 |
| not-in-vault | 3 |
| small-talk | 3 |
| self | 3 |

## Metrics

- **recall@4**: 75%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 45%. The answer names at least one expected note by title.
- **sources-correct**: 89%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 79%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 100%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self); — before the router exists.
- **ungrounded claims**: 0. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 12.9 s, p90 18.9 s — from the question to the first token, including the vault search.
- **total time** p50 21.1 s, p90 30.4 s — from the question to the last token.
- **tokens/sec**: 6.9. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.2 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.4 GB; swap used 7.0 GB before → 6.8 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) | 100% | — | 100% | 67% | 100% | — | 0 |
| cross-language | 6 | 3/6 (50%) | 42% | — | 100% | 33% | 50% | — | 0 |
| named-note | 4 | 4/4 (100%) | 100% | — | 100% | 75% | 100% | — | 0 |
| follow-up | 2 | 1/2 (50%) | 50% | — | 100% | 0% | 50% | — | 0 |
| recent | 4 | 1/4 (25%) | 52% | 50% | 100% | 25% | 100% | — | 0 |
| tasks | 7 | 6/7 (86%) | 87% | 85% | 100% | 43% | 100% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | 100% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 30/38 (79%) | 75% | 79% | 100% | 45% | 89% | 100% | 0 |

## Compared to 2026-10-03 13-01 — 3.2 router, fixed

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) (=) | 100% (=) | — | 100% | 67% | 100% (=) | — | 0 (was 0) |
| cross-language | 6 | 3/6 (50%) (=) | 42% (=) | — | 100% | 33% | 50% (=) | — | 0 (was 1) |
| named-note | 4 | 4/4 (100%) (=) | 100% (=) | — | 100% | 75% | 100% (=) | — | 0 (was 0) |
| follow-up | 2 | 1/2 (50%) (=) | 50% (=) | — | 100% | 0% | 50% (=) | — | 0 (was 0) |
| recent | 4 | 1/4 (25%) ▲ +25 pt | 52% ▲ +52 pt | 50% ▲ +50 pt | 100% | 25% | 100% ▲ +100 pt | — | 0 (was 0) |
| tasks | 7 | 6/7 (86%) ▲ +71 pt | 87% ▲ +58 pt | 85% ▲ +65 pt | 100% | 43% | 100% ▲ +71 pt | — | 0 (was 0) |
| not-in-vault | 3 | 3/3 (100%) (=) | — | — | 100% | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| **overall** | 38 | 30/38 (79%) ▲ +16 pt | 75% ▲ +21 pt | 79% ▲ +63 pt | 100% | 45% | 89% ▲ +26 pt | 100% | 0 (was 1) |

- pass → fail: none
- fail → pass: `recent-ru-since-monday`, `tasks-open-last-week`, `tasks-done`, `tasks-ru-overdue`, `tasks-open-wednesday`, `tasks-en-finished-last-week`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 14.9 s | 20.8 s | 23.0 s | 30.7 s | 6.7 |
| cross-language | 13.6 s | 18.3 s | 20.8 s | 29.1 s | 6.9 |
| named-note | 18.3 s | 25.7 s | 24.2 s | 34.7 s | 6.5 |
| follow-up | 14.5 s | 18.3 s | 23.0 s | 24.3 s | 6.6 |
| recent | 15.4 s | 15.8 s | 25.4 s | 33.0 s | 6.4 |
| tasks | 3.5 s | 9.1 s | 14.6 s | 17.6 s | 6.9 |
| not-in-vault | 10.8 s | 12.2 s | 15.0 s | 21.1 s | 6.8 |
| small-talk | 1.5 s | 1.9 s | 5.1 s | 5.8 s | 7.6 |
| self | 1.9 s | 1.9 s | 8.2 s | 9.0 s | 7.8 |
| **overall** | 12.9 s | 18.9 s | 21.1 s | 30.4 s | 6.9 |

## Error analysis

- `cross-ru-en-notifications` (cross-language) — wrong note: expected Lark plan; read Идеи по монетизации, Lark log
- `recent-wednesday` (recent) — wrong note: expected 2026-09-23 — v0.7; read 2026-09-21, 2026-09-23, 2026-09-21 — v0.6, 2026-09-22
- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Bike maintenance manual
- `cross-en-ru-kitchen` (cross-language) — retrieval miss: expected Ремонт кухни; read nothing
- `cross-en-ru-borscht` (cross-language) — retrieval miss: expected Борщ; read nothing

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 3 |
| wrong note | 3 |
| missing items | 2 |

## Appendix: cases

### same-sourdough-ratio · same-language · PASS

**Question:** What's the feeding ratio for my sourdough starter?

**Router:** **notes** · “What's the feeding ratio for my sourdough starter?” · en: sourdough starter · ru: закваска · 13.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.50)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 4.50)

**Answer:**

> Your current routine (since September 2026) uses a **1:5:5** ratio (10 g starter to 50 g flour and 50 g water). For long trips, you feed at a **1:10:10** ratio before refrigerating it.

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 20.8 s, total 30.7 s, search 13.5 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · PASS

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** **notes** · “When is my half marathon, and what time am I aiming for?” · en: half marathon · 10.7 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Your goal is the Oslo half marathon on 8 November 2026, under a time of 1:50 (Running plan). Do you need help adjusting your long run schedule to hit that target?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.7 s, total 24.0 s, search 10.7 s, 6.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-chain-wear · same-language · PASS

**Question:** What's the wear limit for my 11-speed chain?

**Router:** **notes** · “What's the wear limit for my 11-speed chain?” · en: wear limit, chain · 10.6 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Chain (`Long/Bike maintenance manual.md`, score 5.83)

**Answer:**

> The wear limit is **0.5% elongation**. This comes from *Bike maintenance manual (Long/Bike maintenance manual.md › Chain)*, which notes that using an 11-speed chain beyond this point will cause the cassette and chainrings to wear prematurely. Would you like to know how often to measure it?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 18.9 s, total 29.5 s, search 10.6 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-emergency-fund · same-language · PASS

**Question:** Сколько мне нужно накопить на подушку безопасности?

**Router:** **notes** · “Сколько мне нужно накопить на подушку безопасности?” · en: emergency fund · ru: подушка безопасности · 9.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Подушка безопасности › Подушка безопасности (`Финансы/Подушка безопасности.md`, score 6.00)

**Answer:**

> Вам нужно накопить **540 000 рублей** (6 месяцев расходов по ~90 000 руб/мес). Сейчас у вас есть 310 000.
> 
> Что вы планируете делать с оставшейся суммой?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 14.3 s, total 22.9 s, search 9.2 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-sleep · same-language · PASS

**Question:** Во сколько мне лучше ложиться спать?

**Router:** **notes** · “Во сколько мне лучше ложиться спать?” · en: sleep · ru: сон · 8.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Сон › Сон (`Здоровье/Сон.md`, score 3.00)

**Answer:**

> Лучше ложиться до 23:30; при этом график работает для вас в паре с подъёмом в 7:00 и отказом от экранов за час до сна (Здоровье/Сон.md › Сон). Хотите, я добавлю это напоминание прямо сейчас?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 12.9 s, total 22.1 s, search 8.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-no-course · same-language · PASS

**Question:** Hvilke dager har jeg norskkurs?

**Router:** **notes** · “Hvilke dager har jeg norskkurs?” · en: Norwegian course · ru: норвежский курс · 9.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Norskkurs › Norskkurs (`Norsk/Norskkurs.md`, score 3.00)
- Hytteturen › Hytteturen (`Norsk/Hytteturen.md`, score 2.83)

**Answer:**

> Du har Norsk B1-kurs hos Folkeuniversitetet tirsdager og torsdager kl. 18.00–20.00 (kilder: Norskkurs). Skal vi planlegge øvingsøkter mellom disse dagene?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 14.9 s, total 23.0 s, search 9.0 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** · “Что я решил про уведомления в Lark?” · en: Lark notifications · ru: уведомления Lark · 9.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.58)
- Lark log › Entries (`Projects/Lark/Lark log.md`, score 2.58)

**Answer:**

> Вы решили не использовать подписки и рекламу, чтобы трекер привычек оставался простым; уведомления являются частью функционала для отслеживания streaks (серий). См. *«Идеи по монетизации Lark»* и *«Lark log»*. Как вы планируете интегрировать их в систему наград?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 18.3 s, total 29.0 s, search 9.2 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-sourdough · cross-language · PASS

**Question:** Какое соотношение при кормлении закваски я сейчас использую?

**Router:** **notes** · “Какое соотношение при кормлении закваски я сейчас использую?” · en: starter ratio · ru: соотношение закваски · 9.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 3.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 2.67)

**Answer:**

> Вы используете соотношение **1:5:5** (10 г закваски, 50 г муки, 50 г воды) один раз в день. Это указано в записи *Sourdough starter* с сентября 2026 года [Recipes/Sourdough starter.md]. Вы забыли упомянуть, что используете половину ржаной и половины белой хлебной муки?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.2 s, total 29.1 s, search 9.4 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-marathon · cross-language · PASS

**Question:** Когда у меня полумарафон?

**Router:** **notes** · “Когда у меня полумарафон?” · en: half marathon · ru: полумарафон · 8.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Ваша цель — Ословский полумарафон в ноябре 2026 года (8 ноября). Это указано в заметке «Running plan». Хотите сосредоточиться на темпе для этой даты сейчас или обсудить график тренировок до него?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 13.5 s, total 21.4 s, search 8.5 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-borscht · cross-language · FAIL

**Question:** How long do I bake the beets for borscht?

**Router:** **notes** · “How long do I bake the beets for borscht?” · en: beets · ru: свекла · 8.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain information on baking times for beets used in borscht. Do you have a note detailing your specific recipe or cooking method?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 12.8 s, total 17.2 s, search 8.8 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-kitchen · cross-language · FAIL

**Question:** Who is doing my kitchen renovation and what's the budget?

**Router:** **notes** · “Who is doing my kitchen renovation and what's the budget?” · en: kitchen renovation · 9.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no information about who is doing your kitchen renovation or the associated budget. Do you have a separate note on home projects I can check later?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 13.6 s, total 18.0 s, search 9.3 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-monetisation · cross-language · PASS

**Question:** How did I decide to make money with Lark?

**Router:** **notes** · “How did I decide to make money with Lark?” · en: Lark · 10.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark plan › Streak rules (`Projects/Lark/Lark plan.md`, score 2.70)

**Answer:**

> The vault does not contain notes about how you decided to make money with Lark. Would you like to jot down that idea so Recto can remember it for next time?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 50%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 15.5 s, total 20.8 s, search 10.5 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · PASS

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **notes** · “Look in Beta feedback - what do testers ask for most?” · en: Beta feedback · 9.6 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Beta feedback › Beta feedback (`Projects/Lark/Beta feedback.md`, score 5.70)
- Localise into Norwegian › Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 4.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 3.53)
- 2026-09-25 — v0.8: TestFlight beta › 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.58)

**Answer:**

> The feature requested by far is "Weekly goals," which was asked for by 7 of the 12 TestFlight testers [[Beta feedback]]. Would you like to draft that goal structure next?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 18.3 s, total 24.2 s, search 9.7 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · PASS

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **notes** · “Посмотри в Lark plan, какая платформа первая?” · en: Lark · 10.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 2.53)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 2.44)
- Lark plan › Release (`Projects/Lark/Lark plan.md`, score 2.53)

**Answer:**

> Первой платформой для выхода продукта является iPhone (iOS), так как приложение описывается как «small habit tracker for iPhone» [[Lark plan]]. 
> 
> Есть ли у тебя идеи по адаптации функционала под другие ОС сейчас или позже?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.3 s, total 24.0 s, search 10.2 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · en: sourdough starter · ru: дрожжевая закваска · 10.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 6.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.25)
- Apartment move checklist › Apartment move checklist (`Home/Apartment move checklist.md`, score 2.83)
- Bike maintenance manual › Cassette (`Long/Bike maintenance manual.md`, score 4.08)
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 4.08)

**Answer:**

> You previously fed your old sourdough starter twice a day at a 1:1:1 ratio using only white flour, which resulted in it being too sour and peaking in just three hours. Would you like me to remind you of the current feeding routine for comparison?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 25.7 s, total 34.7 s, search 10.3 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · PASS

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** **notes** · “In Deep Work, how many hours of deep work a day did I aim for?” · en: Deep Work · 9.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Deep Work › Deep Work (`Reading/Deep Work.md`, score 7.00)
- 2026-09-18 › 2026-09-18 (`Daily/2026/09/W38/2026-09-18.md`, score 3.87)
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 3.62)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 2.63)
- 2026-09-18 › Option tasks (`Daily/2026/09/W38/2026-09-18.md`, score 3.87)
- 2026-09-15 › Option tasks (`Daily/2026/09/W38/2026-09-15.md`, score 3.62)

**Answer:**

> You aimed for four hours of deep work per day. This comes from the note where you listed your takeaways on Cal Newport's *Deep Work*, which explicitly states: "Aim for four hours of deep work a day; more is rarely possible." 
> 
> Did this target align with how much time you actually found available in your recent schedule?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 19.6 s, total 30.4 s, search 9.5 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** · “And where did I write that down?” · named: notifications · 9.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 2.75)
- Bike maintenance manual › Pedals (`Long/Bike maintenance manual.md`, score 2.75)

**Answer:**

> I don't have any notes regarding your decisions on Lark notifications in the vault yet. Did you perhaps save those thoughts elsewhere or forget to add them?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 18.3 s, total 23.0 s, search 9.0 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · PASS

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** · “А где мы там ели?” · en: Tbilisi · ru: Тбилиси · 9.9 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Тбилиси › Тбилиси (`Путешествия/Тбилиси.md`, score 3.00)

**Answer:**

> Вы ели: хинкали — в ресторане «Зодиак», хачапури по-аджарски — в заведении «Сакхачапуре №1», а вино пили в баре «Вино Андеграунд». Что ещё хотели попробовать?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 14.5 s, total 24.3 s, search 9.9 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-last-week · recent · FAIL

**Question:** What did I work on in Lark last week?

**Router:** **recent** · “What did I work on in Lark last week?” · en: work, lark, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-21, 2026-09-27)` by the harness → 13 notes: 2026-09-21, 2026-09-21 — v0.6: Onboarding redesign, 2026-09-22, 2026-09-23, 2026-09-23 — v0.7: Dark mode and accessibility, 2026-09-24, 2026-09-25, 2026-09-25 — v0.8: TestFlight beta +5

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-21 — v0.6: Onboarding redesign (`Projects/Lark/Lark log/2026-09-21 — v0.6.md`, score 2.90)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.80)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.70)
- 2026-09-23 — v0.7: Dark mode and accessibility (`Projects/Lark/Lark log/2026-09-23 — v0.7.md`, score 2.60)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.50)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.40)
- 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.30)
- 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 2.20)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 2.10)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.00)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 1.90)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 1.80)

**Answer:**

> Last week you shipped the **Onboarding redesign (v0.6)**, replacing a five-screen tutorial with one screen to pick up to three habits, which dropped first-day drop-off from 40% to 18%. You also implemented **Dark mode** and full VoiceOver accessibility in v0.7, fixed contrast issues for streak counters, and sent the first TestFlight build (v0.8) to 12 testers on September 25th.
> 
> Did you want details about any specific feature or bug fix?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 33%, named in answer false, sources correct true, honest —, language ok — retrieval miss

**Timings:** TTFT 15.8 s, total 33.0 s, search 0.0 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-wednesday · recent · FAIL

**Question:** What did I do on Wednesday last week?

**Router:** **recent** · “What did I do on Wednesday last week?” · en: wednesd, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-21, 2026-09-27)` by the harness → 13 notes: 2026-09-21, 2026-09-23, 2026-09-21 — v0.6: Onboarding redesign, 2026-09-22, 2026-09-23 — v0.7: Dark mode and accessibility, 2026-09-24, 2026-09-25, 2026-09-25 — v0.8: TestFlight beta +5

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.90)
- 2026-09-21 — v0.6: Onboarding redesign (`Projects/Lark/Lark log/2026-09-21 — v0.6.md`, score 2.80)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.70)
- 2026-09-23 — v0.7: Dark mode and accessibility (`Projects/Lark/Lark log/2026-09-23 — v0.7.md`, score 2.60)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.50)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.40)
- 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.30)
- 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 2.20)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 2.10)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.00)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 1.90)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 1.80)

**Answer:**

> On Wednesday (September 23), you worked on **v0.7**: implementing the dark mode palette with warm greys, adding VoiceOver labels to every control, enabling Dynamic Type up to maximum size, and fixing contrast for the streak counter. You also had a one-on-one meeting scheduled with Maria.

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct true, honest —, language ok — wrong note

**Timings:** TTFT 15.4 s, total 25.4 s, search 0.0 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-ru-since-monday · recent · PASS

**Question:** Что нового в Lark с понедельника?

**Router:** **recent** · “Что нового в Lark с понедельника?” · en: нового, lark, понедельни · period 2026-09-28..2026-09-30 · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-28, 2026-09-30)` by the harness → 6 notes: 2026-09-28, 2026-09-28 — v0.9: Widget crash fixed, 2026-09-29, 2026-09-30, Экспорт, Weekly goals

**Notes in context:**
- 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 3.00)
- 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 2.90)
- 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.80)
- 2026-09-30 (`Daily/2026/09/W40/2026-09-30.md`, score 2.70)
- Экспорт (`Projects/Lark/Экспорт.md`, score 2.60)
- Weekly goals (`tasks/Weekly goals.md`, score 2.50)

**Answer:**

> С понедельника (сентябрь 30): началась планирование релиза для App Store, продолжена работа над политикой конфиденциальности и экспортом данных (добавлен JSON-формат за исключением истории отметок). Также были собраны бета-тесты: самый частый запрос — привычки три раза в неделю.
> 
> Вы планируете этот релиз 20 октября?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 9.7 s, total 22.9 s, search 0.0 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-last-week · tasks · PASS

**Question:** Which Lark tasks from last week are still open, and which are done?

**Router:** **tasks** · “Which Lark tasks from last week are still open, and which are done?” · en: lark, tasks, last, week, still, open · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-21, 2026-09-27)` by the harness → 9 open, 5 done: 2026-09-21, Write privacy policy, App Store screenshots, Localise into Norwegian, VoiceOver labels, Fix widget crash on iOS 17

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.90)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.80)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.70)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 2.60)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 2.50)

**Answer:**

> Open: Write Lark privacy policy (due 26 Sep), App Store screenshots (in progress, due 3 Oct), Localise into Norwegian (due 15 Oct). Done in this period: VoiceOver labels, Fix widget crash on iOS 17. Did we need to cross-reference the overdue policy with our current compliance requirements?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 67%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.4 s, total 15.3 s, search 0.0 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-done · tasks · PASS

**Question:** Which Lark tasks are done?

**Router:** **tasks** · “Which Lark tasks are done?” · en: lark, tasks · 0.0 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: VoiceOver labels, Fix widget crash on iOS 17

**Notes in context:**
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 3.00)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 2.90)

**Answer:**

> The completed Lark-related tasks from the period 2026-09-17 to 2026-09-30 are: VoiceOver labels and Fix widget crash on iOS 17 (from "Done"). Which of these do you need next?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.1 s, total 17.6 s, search 6.1 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-ru-overdue · tasks · PASS

**Question:** Какие задачи у меня просрочены?

**Router:** **tasks** · “Какие задачи у меня просрочены?” · en: какие, задачи, просроче · 0.0 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: Write privacy policy

**Notes in context:**
- Write privacy policy (`tasks/Write privacy policy.md`, score 3.00)

**Answer:**

> У вас одна просроченная задача: написать политику конфиденциальности (срок 26 сен).
> Нужно ли помочь с её написанием прямо сейчас?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 2.9 s, total 8.5 s, search 0.0 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-real-ru-last-week · tasks · FAIL

**Question:** что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику

**Router:** **tasks** · “что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику” · en: додел, прошл, недели, посмот, задачи, одну, специфи · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-21, 2026-09-27)` by the harness → 9 open, 5 done: 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, Write privacy policy, App Store screenshots, Localise into Norwegian +2

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.90)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.80)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.70)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.60)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.50)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.40)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.30)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 2.20)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 2.10)

**Answer:**

> Срок 21 сен — написать политику конфиденциальности Lark (просрочено), срок 26 сен; Разобрать фото из Лиссабона. Это всё что осталось в списке «Не доделано» с этого периода, есть ли у тебя план как их закрыть?

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok — missing items

**Timings:** TTFT 5.2 s, total 14.6 s, search 0.0 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-wednesday · tasks · PASS

**Question:** What's still open from Wednesday?

**Router:** **tasks** · “What's still open from Wednesday?” · en: still, open, wednesd · period 2026-09-23..2026-09-23 · 0.0 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-23, 2026-09-23)` by the harness → 6 open, 0 done: 2026-09-23, Write privacy policy, App Store screenshots

**Notes in context:**
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 3.00)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.90)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.80)

**Answer:**

> Still open (6): • 23 Sep - Write Lark privacy policy; Разобрать фото из Лиссабона; Записаться к стоматологу; Try the new interval session Cards: Write privacy policy (to do, due 26 Sep - overdue); App Store screenshots (in progress, due 3 Oct)
> 
> Want to tackle the overdue privacy policy first?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 3.4 s, total 15.1 s, search 0.0 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-en-finished-last-week · tasks · PASS

**Question:** Which tasks did I finish last week?

**Router:** **tasks** · “Which tasks did I finish last week?” · en: tasks, finish, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-21, 2026-09-27)` by the harness → 9 open, 5 done: VoiceOver labels, 2026-09-24, 2026-09-25, Fix widget crash on iOS 17, 2026-09-27

**Notes in context:**
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 3.00)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.90)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.80)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 2.70)
- 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 2.60)

**Answer:**

> You finished VoiceOver labels on 24 Sep, reviewed Maria's payments doc the same day, bought a gift for Anna on 25 Sep, fixed an iOS 17 widget crash, and completed a long run of 16 km on 27 Sep. Did any of these tasks trigger new ideas?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 67%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 3.5 s, total 13.1 s, search 0.0 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-loose-export · tasks · PASS

**Question:** Что мне ещё осталось доделать по экспорту?

**Router:** **tasks** · “Что мне ещё осталось доделать по экспорту?” · en: ещё, остало, додела, экспор · 0.0 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: Экспорт

**Notes in context:**
- Экспорт (`Projects/Lark/Экспорт.md`, score 3.00)

**Answer:**

> Нужно доделать экспорт в JSON и проверить работу с часовыми поясами (без чекбокса). Это из задачи «Не доделано про «экспорту» (2)». Что именно вызывает сомнения при проверке таймзоны?

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 3.5 s, total 11.2 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-what-did-i-do · recent · FAIL

**Question:** What did I do last week?

**Router:** **recent** · “What did I do last week?” · en: last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-21, 2026-09-27)` by the harness → 13 notes: 2026-09-21, 2026-09-21 — v0.6: Onboarding redesign, 2026-09-22, 2026-09-23, 2026-09-23 — v0.7: Dark mode and accessibility, 2026-09-24, 2026-09-25, 2026-09-25 — v0.8: TestFlight beta +5

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-21 — v0.6: Onboarding redesign (`Projects/Lark/Lark log/2026-09-21 — v0.6.md`, score 2.90)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.80)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.70)
- 2026-09-23 — v0.7: Dark mode and accessibility (`Projects/Lark/Lark log/2026-09-23 — v0.7.md`, score 2.60)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.50)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.40)
- 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.30)
- 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 2.20)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 2.10)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.00)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 1.90)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 1.80)

**Answer:**

> Last week on **2026-09-25**, you sent the first TestFlight build to 12 testers and bought Anna's birthday gift (from your tasks list). You also completed a long run of 16 km on Sunday, according to notes from **2026-09-27**.

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 75%, named in answer true, sources correct true, honest —, language ok — missing items

**Timings:** TTFT 15.8 s, total 27.0 s, search 0.0 s, 6.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** **notes** · “What's the capital of Australia?” · en: Australia · 8.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The provided context does not contain information about Australian capitals to answer your question. Did you have other topics or personal records stored that we could explore instead?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 10.4 s, total 15.0 s, search 8.3 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · PASS

**Question:** What did I write about my trip to Japan?

**Router:** **notes** · “What did I write about my trip to Japan?” · en: Japan · ru: Япония · 8.7 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I found no notes regarding a trip to Japan in your vault. Did you perhaps record those details under a different title or location?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 10.8 s, total 14.6 s, search 8.7 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-ru-netflix · not-in-vault · PASS

**Question:** Что я решил про подписку на Netflix?

**Router:** **notes** · “Что я решил про подписку на Netflix?” · en: Netflix · ru: Netflix · 8.6 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.83)

**Answer:**

> В записях о монетизации Lark указано лишь решение отказаться от подписок для этого проекта (выбрал разовую покупку вместо неё). Отношение к подписке на самом сервисе Netflix в заметках не отражено. Вы планировали сравнивать эти модели?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 12.2 s, total 21.1 s, search 8.6 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-hi · small-talk · PASS

**Question:** hi!

**Router:** **smalltalk** · “hi!” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Hello. What would you like to explore in your vault? How does today's inquiry connect with what you've written before?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.5 s, total 5.1 s, search 0.0 s, 7.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-ru-thanks · small-talk · PASS

**Question:** Спасибо, очень помог!

**Router:** **smalltalk** · “Спасибо, очень помог!” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Рада помочь. Есть ли что-то еще в вашей записной книжке, которое вы хотели бы найти или обсудить?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.9 s, total 5.8 s, search 0.0 s, 7.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-nice · small-talk · PASS

**Question:** haha nice

**Router:** **smalltalk** · “haha nice” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> That's good to hear! Is there a specific folder or topic in the vault we should look at next?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.5 s, total 4.3 s, search 0.0 s, 8.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-model · self · PASS

**Question:** What model are you?

**Router:** **self** · “What model are you?” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I am Recto, the keeper of this vault; I answer using only your stored notes and will not identify myself as a specific AI model or provide external information if it isn't found in your context. Do you have any questions about the topics recorded within your vault?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.7 s, total 9.0 s, search 0.0 s, 7.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-ru-knowledge-year · self · PASS

**Question:** Из какого года твои знания?

**Router:** **self** · “Из какого года твои знания?” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Мои записи охватывают события с середины XX века по настоящее время (2024 год), согласно нотно `vault_context_1`. Вы хотели бы узнать больше о какой-то конкретной эпохе из этих записей?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.9 s, total 8.2 s, search 0.0 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-privacy · self · PASS

**Question:** Are my notes sent anywhere?

**Router:** **self** · “Are my notes sent anywhere?” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault is a private space; your notes are not sent outside unless you explicitly share them with others or use external tools that transmit data by design. Did you write down any specific concerns about where your content might go in the past?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.9 s, total 7.9 s, search 0.0 s, 8.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
