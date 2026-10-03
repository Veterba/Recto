---
run_id: "2026-10-03 13-29 — 3.3 task index, list by the harness"
date: 2026-10-03T11:29:50.644Z
model: qwen3.5:9b
commit: 0bca99b (dirty)
report_version: 1
compared_to: "2026-10-03 13-14 — 3.3 task index, fixed"
---

# Recto Eval: 3.3 task index, list by the harness

## Summary

Compared to "2026-10-03 13-14 — 3.3 task index, fixed", what changed: nothing in the setup (same model, code, prompt and cases) - differences are the model’s own variation. 33 of 38 cases pass (87%), recall@4 80%, time to first token 10.2 s at the median (p90 19.7 s), 7.3 tokens/s. Pass rate 79% → 87%, recall@4 75% → 80%, TTFT p50 12.9 s → 10.2 s. Biggest win: recent (▲ +50 pt). No kind got worse.

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 15.0 tokens/s (a throttling Mac shows under 5)
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

- **recall@4**: 80%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 55%. The answer names at least one expected note by title.
- **sources-correct**: 89%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 96%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 100%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self); — before the router exists.
- **ungrounded claims**: 2. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 10.2 s, p90 19.7 s — from the question to the first token, including the vault search.
- **total time** p50 17.8 s, p90 40.5 s — from the question to the last token.
- **tokens/sec**: 7.3. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.0 GB resident, the model 5.8 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.4 GB; swap used 6.8 GB before → 5.5 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) | 100% | — | 100% | 67% | 100% | — | 0 |
| cross-language | 6 | 3/6 (50%) | 42% | — | 100% | 33% | 50% | — | 1 |
| named-note | 4 | 4/4 (100%) | 100% | — | 100% | 100% | 100% | — | 0 |
| follow-up | 2 | 1/2 (50%) | 50% | — | 100% | 0% | 50% | — | 0 |
| recent | 4 | 3/4 (75%) | 94% | 75% | 100% | 50% | 100% | — | 1 |
| tasks | 7 | 7/7 (100%) | 87% | 100% | 100% | 57% | 100% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | 100% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 33/38 (87%) | 80% | 96% | 100% | 55% | 89% | 100% | 2 |

## Compared to 2026-10-03 13-14 — 3.3 task index, fixed

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) (=) | 100% (=) | — | 100% | 67% | 100% (=) | — | 0 (was 0) |
| cross-language | 6 | 3/6 (50%) (=) | 42% (=) | — | 100% | 33% | 50% (=) | — | 1 (was 0) |
| named-note | 4 | 4/4 (100%) (=) | 100% (=) | — | 100% | 100% | 100% (=) | — | 0 (was 0) |
| follow-up | 2 | 1/2 (50%) (=) | 50% (=) | — | 100% | 0% | 50% (=) | — | 0 (was 0) |
| recent | 4 | 3/4 (75%) ▲ +50 pt | 94% ▲ +42 pt | 75% ▲ +25 pt | 100% | 50% | 100% (=) | — | 1 (was 0) |
| tasks | 7 | 7/7 (100%) ▲ +14 pt | 87% (=) | 100% ▲ +15 pt | 100% | 57% | 100% (=) | — | 0 (was 0) |
| not-in-vault | 3 | 3/3 (100%) (=) | — | — | 100% | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| **overall** | 38 | 33/38 (87%) ▲ +8 pt | 80% ▲ +6 pt | 96% ▲ +17 pt | 100% | 55% | 89% (=) | 100% | 2 (was 0) |

- pass → fail: none
- fail → pass: `recent-last-week`, `recent-wednesday`, `tasks-real-ru-last-week`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 9.5 s | 40.7 s | 14.2 s | 53.6 s | 10.8 |
| cross-language | 15.2 s | 17.9 s | 22.3 s | 26.3 s | 6.8 |
| named-note | 18.4 s | 25.3 s | 27.0 s | 34.5 s | 6.7 |
| follow-up | 16.5 s | 20.8 s | 25.8 s | 27.9 s | 6.6 |
| recent | 8.1 s | 18.6 s | 23.9 s | 43.8 s | 6.3 |
| tasks | 0.0 s | 6.8 s | 10.9 s | 13.0 s | 6.5 |
| not-in-vault | 13.2 s | 16.0 s | 17.1 s | 27.3 s | 6.7 |
| small-talk | 4.2 s | 4.4 s | 7.7 s | 8.4 s | 7.0 |
| self | 4.1 s | 4.3 s | 9.4 s | 12.4 s | 7.0 |
| **overall** | 10.2 s | 19.7 s | 17.8 s | 40.5 s | 7.3 |

## Error analysis

- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Bike maintenance manual
- `cross-ru-en-notifications` (cross-language) — wrong note: expected Lark plan; read Идеи по монетизации, Lark log; ungrounded claim: named “2026-09-15 — v0.4” without having it
- `cross-en-ru-borscht` (cross-language) — retrieval miss: expected Борщ; read nothing
- `cross-en-ru-kitchen` (cross-language) — retrieval miss: expected Ремонт кухни; read nothing
- `recent-what-did-i-do` (recent) — ungrounded claim: named “projects/lark/lark log,” without having it

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 2 |
| wrong note | 2 |
| ungrounded claim | 2 |

## Appendix: cases

### same-sourdough-ratio · same-language · PASS

**Question:** What's the feeding ratio for my sourdough starter?

**Router:** **notes** · “What's the feeding ratio for my sourdough starter?” · en: sourdough starter · ru: закваска · 10.9 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.50)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 4.50)

**Answer:**

> Your current routine uses a **1:5:5** ratio (10 g starter : 50 g flour : 50 g water) with half rye and half white bread flour, fed once daily until room temperature. For long trips, you feed it at a **1:10:10** ratio before refrigerating it.
> 
> Did the switch from your old twice-daily feeding help stabilize your peak time?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 14.9 s, total 20.9 s, search 10.9 s, 15.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · PASS

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** **notes** · “When is my half marathon, and what time am I aiming for?” · en: half marathon · 4.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Your goal is the Oslo Half Marathon on 8 November 2026, with a target time under 1:50 (from *Running plan*). Did you want to adjust your Tuesday interval distances based on that specific cutoff?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 8.1 s, total 11.3 s, search 4.8 s, 15.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-chain-wear · same-language · PASS

**Question:** What's the wear limit for my 11-speed chain?

**Router:** **notes** · “What's the wear limit for my 11-speed chain?” · en: wear limit, chain · 5.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Chain (`Long/Bike maintenance manual.md`, score 5.83)

**Answer:**

> The wear limit for an 11-speed chain is **0.5% elongation**. If you exceed this with a chain checker, replace it immediately to prevent wearing out your cassette and chainrings (Long/Bike maintenance manual.md › Chain). Did you measure yours recently?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 10.2 s, total 14.2 s, search 5.4 s, 14.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-emergency-fund · same-language · PASS

**Question:** Сколько мне нужно накопить на подушку безопасности?

**Router:** **notes** · “Сколько мне нужно накопить на подушку безопасности?” · en: emergency fund · ru: подушка безопасности · 5.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Подушка безопасности › Подушка безопасности (`Финансы/Подушка безопасности.md`, score 6.00)

**Answer:**

> Вам нужно накопить **540 000 рублей** (6 месяцев расходов по ~90 000 руб.). Сейчас у вас есть 310 000, значит осталось собрать ещё 230 000. Хотите ли вы пересчитать срок с момента последней зарплаты?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 8.6 s, total 13.3 s, search 5.1 s, 14.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-sleep · same-language · PASS

**Question:** Во сколько мне лучше ложиться спать?

**Router:** **notes** · “Во сколько мне лучше ложиться спать?” · en: sleep · ru: сон · 4.7 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Сон › Сон (`Здоровье/Сон.md`, score 3.00)

**Answer:**

> Лучше ложиться до 23:30; в этом случае вы обычно встаёте в 7:00 даже в выходные (Здоровье/Сон.md › Сон). Вы хотите придерживаться этого графика и других правил, например, отказ от экранов за час до сна?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.5 s, total 52.7 s, search 4.7 s, 1.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-no-course · same-language · PASS

**Question:** Hvilke dager har jeg norskkurs?

**Router:** **notes** (reply unreadable: defaults) · “Hvilke dager har jeg norskkurs?” · 30.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Norskkurs › Norskkurs (`Norsk/Norskkurs.md`, score 3.00)
- Hytteturen › Hytteturen (`Norsk/Hytteturen.md`, score 2.83)

**Answer:**

> Du har norskkurs tirsdager og torsdager kl. 18.00–20.00 hos Folkeuniversitetet, ifølge notatet *Norskkurs*. Ønsker du å sjekke hva Ingrid lærer oss?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 40.7 s, total 53.6 s, search 30.1 s, 4.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** · “Что я решил про уведомления в Lark?” · en: Lark notifications · ru: уведомления Lark · 9.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.58)
- Lark log › Entries (`Projects/Lark/Lark log.md`, score 2.58)

**Answer:**

> Вы не записали решения именно об уведомлениях; вы упомянули их как одну из функций, которую охватывает трекер привычек [[2026-09-15 — v0.4]]. Хотите ли узнать больше о других функциях Lark?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, ungrounded claim

**Timings:** TTFT 17.9 s, total 26.3 s, search 9.4 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-sourdough · cross-language · PASS

**Question:** Какое соотношение при кормлении закваски я сейчас использую?

**Router:** **notes** · “Какое соотношение при кормлении закваски я сейчас использую?” · en: starter ratio · ru: соотношение закваски · 9.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 3.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 2.67)

**Answer:**

> Вы используете соотношение **1:5:5** (10 г стартера, 50 г муки, 50 г воды) для одного кормления в день. Это указано в заметке «Sourdough starter» как текущий режим с сентября 2026 года.

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.4 s, total 25.3 s, search 9.2 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-marathon · cross-language · PASS

**Question:** Когда у меня полумарафон?

**Router:** **notes** · “Когда у меня полумарафон?” · en: half marathon · ru: полумарафон · 9.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Ваша цель — полумарафон в Осло **8 ноября 2026 года**. Это указано в записке "Running plan". Когда вы планируете следующий длинный забег, чтобы подогреть форму к этой дате?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.2 s, total 23.3 s, search 9.4 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-borscht · cross-language · FAIL

**Question:** How long do I bake the beets for borscht?

**Router:** **notes** · “How long do I bake the beets for borscht?” · en: beets · ru: свекла · 9.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The provided notes contain no information on baking times for beets or making borscht. Did you perhaps record that recipe under a different note title, such as "Borscht Ingredients" or "Vegetable Prep"?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 13.9 s, total 20.9 s, search 9.3 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-kitchen · cross-language · FAIL

**Question:** Who is doing my kitchen renovation and what's the budget?

**Router:** **notes** · “Who is doing my kitchen renovation and what's the budget?” · en: kitchen renovation · 9.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no information about your kitchen renovation contractor or its budget. Do you have a note on that project we should review first?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 13.9 s, total 17.8 s, search 9.4 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-monetisation · cross-language · PASS

**Question:** How did I decide to make money with Lark?

**Router:** **notes** · “How did I decide to make money with Lark?” · en: Lark · 10.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark plan › Streak rules (`Projects/Lark/Lark plan.md`, score 2.70)

**Answer:**

> The current notes in the vault do not contain information on how you decided to monetize Lark; they only cover streak rules and grace days for habits. Did you perhaps record this decision under a different project name or date range?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 50%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 15.5 s, total 22.3 s, search 10.3 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · PASS

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **notes** · “Look in Beta feedback - what do testers ask for most?” · en: Beta feedback · 9.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Beta feedback › Beta feedback (`Projects/Lark/Beta feedback.md`, score 5.70)
- Localise into Norwegian › Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 4.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 3.53)
- 2026-09-25 — v0.8: TestFlight beta › 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.58)

**Answer:**

> The feature requested by far the most is "Weekly goals," asked for by 7 of the 12 TestFlight testers [[Beta feedback]]. A way to pause a habit while travelling was next, with 4 requests. Would you like me to check if this goal logic already exists in your notes?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 18.4 s, total 27.6 s, search 9.5 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · PASS

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **notes** · “Посмотри в Lark plan, какая платформа первая?” · en: Lark · 9.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 2.53)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 2.44)
- Lark plan › Release (`Projects/Lark/Lark plan.md`, score 2.53)

**Answer:**

> Сначала запланирован релиз для iPhone (через TestFlight и App Store), а позже — выход на другие платформы. Это указано в заметке [[Lark plan]] о выпусках продукта. Планируете ли вы внедрять специфические функции iOS, которые потом перенесёте?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.1 s, total 25.4 s, search 9.8 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · en: sourdough starter · ru: дрожжевая закваска · 9.9 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 6.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.25)
- Apartment move checklist › Apartment move checklist (`Home/Apartment move checklist.md`, score 2.83)
- Bike maintenance manual › Cassette (`Long/Bike maintenance manual.md`, score 4.08)
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 4.08)

**Answer:**

> You used a 1:1:1 ratio for your old sourdough starter routine (50 g starter, 50 g flour, 50 g water). This note is from `Sourdough starter (old)`. Why was that one too sour and peaked so fast?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 25.3 s, total 34.5 s, search 9.9 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · PASS

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** **notes** · “In Deep Work, how many hours of deep work a day did I aim for?” · en: Deep Work · 9.5 s

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

> You aimed for four hours of deep work per day. See `Deep Work (Reading/Deep Work.md › Deep Work)`. Did you stick to this target on September 18th when you read the book that evening?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 19.7 s, total 27.0 s, search 9.5 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** · “And where did I write that down?” · named: notifications · 8.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 2.75)
- Bike maintenance manual › Pedals (`Long/Bike maintenance manual.md`, score 2.75)

**Answer:**

> I cannot find any notes regarding your decisions on Lark notifications in the vault. The only information available concerns bike maintenance schedules and torque checks for carbon parts. Would you like to record this decision now so I can track it next time?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 20.8 s, total 27.9 s, search 8.8 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · PASS

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** · “А где мы там ели?” · en: Tbilisi · ru: Тбилиси · 9.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Тбилиси › Тбилиси (`Путешествия/Тбилиси.md`, score 3.00)

**Answer:**

> Хинкали заказывали в ресторане «Зодиак», а хачапури по-аджарски — в заведении «Сакхачапуре №1». Где вы хотите попробовать местное вино дальше, баре «Вино Андеграунд»?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 16.5 s, total 25.8 s, search 9.5 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-last-week · recent · PASS

**Question:** What did I work on in Lark last week?

**Router:** **recent** · “What did I work on in Lark last week?” · en: work, lark, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-21, 2026-09-27)` by the harness → 13 notes: 2026-09-21, 2026-09-21 — v0.6: Onboarding redesign, 2026-09-23 — v0.7: Dark mode and accessibility, 2026-09-25 — v0.8: TestFlight beta, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25 +5

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-21 — v0.6: Onboarding redesign (`Projects/Lark/Lark log/2026-09-21 — v0.6.md`, score 2.90)
- 2026-09-23 — v0.7: Dark mode and accessibility (`Projects/Lark/Lark log/2026-09-23 — v0.7.md`, score 2.80)
- 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.70)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.60)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.50)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.40)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.30)
- 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 2.20)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 2.10)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.00)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 1.90)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 1.80)

**Answer:**

> Last week you shipped the **Onboarding redesign (v0.6)**, replacing five screens with one to drop first-day users from 40% to 18%. You also delivered **Dark mode and accessibility (v0.7)** with warm greys, VoiceOver labels, and Dynamic Type support, plus sent a TestFlight build that crashed on iOS 17.0 for habits without icons.
> 
> *   *See:* `2026-09-21 — v0.6: Onboarding redesign`, `2026-09-23 — v0.7: Dark mode and accessibility`.

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 18.6 s, total 40.5 s, search 0.0 s, 6.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-wednesday · recent · PASS

**Question:** What did I do on Wednesday last week?

**Router:** **recent** · “What did I do on Wednesday last week?” · en: wednesd, last, week · period 2026-09-23..2026-09-23 · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-23, 2026-09-23)` by the harness → 2 notes: 2026-09-23, 2026-09-23 — v0.7: Dark mode and accessibility

**Notes in context:**
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 3.00)
- 2026-09-23 — v0.7: Dark mode and accessibility (`Projects/Lark/Lark log/2026-09-23 — v0.7.md`, score 2.90)

**Answer:**

> On Wednesday, 23 September 2026 (the only Wednesday in your provided notes), you focused on "Dark mode and VoiceOver" for a project v0.7 update involving warm greys, amber accents, accessible controls up to Dynamic Type sizes, and fixed contrast for the streak counter. You also had tasks pending like writing Lark's privacy policy and buying a gift for Anna. Do you want details about any of those specific tasks?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 4.8 s, total 18.6 s, search 0.0 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-ru-since-monday · recent · PASS

**Question:** Что нового в Lark с понедельника?

**Router:** **recent** · “Что нового в Lark с понедельника?” · en: нового, lark, понедельни · period 2026-09-28..2026-09-30 · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-28, 2026-09-30)` by the harness → 6 notes: 2026-09-28 — v0.9: Widget crash fixed, Экспорт, 2026-09-28, 2026-09-29, 2026-09-30, Weekly goals

**Notes in context:**
- 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 3.00)
- Экспорт (`Projects/Lark/Экспорт.md`, score 2.90)
- 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 2.80)
- 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.70)
- 2026-09-30 (`Daily/2026/09/W40/2026-09-30.md`, score 2.60)
- Weekly goals (`tasks/Weekly goals.md`, score 2.50)

**Answer:**

> С понедельника (28–30 сентября) были исправлен крах виджета на iOS 17.0 и начата переделка экспорта: остался CSV, добавляется JSON для резервной копии, но пока выгружаются только привычки без истории отметок до релиза от 20 октября. Также был собран бэта-фидбек с запросом функции «три раза в неделю» вместо ежедневной.
> 
> Что из этого нужно сделать в первую очередь?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 8.1 s, total 23.9 s, search 0.0 s, 6.5 tokens/s

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

> Still open about “Lark” (4):
> • 21 Sep - Write Lark privacy policy
> Cards: Write privacy policy (to do, due 26 Sep - overdue); App Store screenshots (in progress, due 3 Oct); Localise into Norwegian (to do, due 15 Oct)
> 
> Done in this period: 2 - VoiceOver labels, Fix widget crash on iOS 17.
> 
> Open: Write privacy policy (overdue), App Store screenshots (in progress due 3 Oct), Localise into Norwegian (to do due 15 Oct). Done: VoiceOver labels, Fix widget crash on iOS 17. Would you like to start the overdue items?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 67%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 12.3 s, search 0.0 s, 6.4 tokens/s

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

> Done (2):
> • VoiceOver labels
> • Fix widget crash on iOS 17
> 
> Still open (5).
> 
> The voiceover labels and fixing widget crash on iOS 17 have been completed; would you like to see details from those notes?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 6.8 s, total 13.0 s, search 6.8 s, 6.8 tokens/s

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

> Просрочено (1):
> • Write privacy policy (не начато, срок 26 сен - просрочено)
> 
> Просрочена задача «Написать политику конфиденциальности» (срок 26 сен). Хотите, я помогу с её выполнением прямо сейчас?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 7.7 s, search 0.0 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-real-ru-last-week · tasks · PASS

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

> Не доделано (9):
> • 21 сен - Write Lark privacy policy
> • 22 сен - Разобрать фото из Лиссабона
> • 23 сен - Записаться к стоматологу; Try the new interval session
> • 24 сен - Отправить отчёт по расходам
> • 25 сен - Order fibre internet for the new flat
> Карточки: Write privacy policy (не начато, срок 26 сен - просрочено); App Store screenshots (в работе, срок 3 окт); Localise into Norwegian (не начато, срок 15 окт)
> 
> Сделано за этот период: 5 - VoiceOver labels, Review Maria's payments doc, Купить подарок Ане на день рождения, Fix widget crash on iOS 17, и ещё 1.
> 
> Вы пропустили задачу на запись к стоматологу от 23 сентября (см. заметки «Не доделано»). Что ещё нужно проверить в этом списке?

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 10.1 s, search 0.0 s, 6.6 tokens/s

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

> Still open (6):
> • 23 Sep - Write Lark privacy policy; Разобрать фото из Лиссабона; Записаться к стоматологу; Try the new interval session
> Cards: Write privacy policy (to do, due 26 Sep - overdue); App Store screenshots (in progress, due 3 Oct)
> 
> The "Try the new interval session" task is marked as due 27 Sep (Wednesday) and remains in progress, while other overdue items like writing the privacy policy are also still open. Which one would you prioritize today?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 10.2 s, search 0.0 s, 6.4 tokens/s

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

> Done (5):
> • VoiceOver labels
> • 24 Sep - Review Maria's payments doc
> • 25 Sep - Купить подарок Ане на день рождения
> • Fix widget crash on iOS 17
> • 27 Sep - Long run 16 km
> 
> Still open (9).
> 
> You completed "Review Maria's payments doc" on 24 Sep and "Long run 16 km" on 27 Sep, among others listed in Done (5). Did you want to move any of the open items from September as well?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 67%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 11.1 s, search 0.0 s, 6.3 tokens/s

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

> Не доделано про «экспорту» (2):
> • Экспорт - надо доделать экспорт в JSON; проверить, как экспорт работает с часовыми поясами (без чекбокса)
> 
> В заметке «Не доделано про «экспорту» (2)» указано, что нужно завершить экспорт в JSON и проверить работу с часовыми поясами без чекбокса; хотите ли вы уточнить детали проверки таймзоны?

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 10.9 s, search 0.0 s, 6.4 tokens/s

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

> Last week you shipped the **Onboarding redesign v0.6** (replacing five screens with one, dropping first-day drop-off from 40% to 18%) and implemented **Dark mode plus accessibility features** for VoiceOver and Dynamic Type in v0.7 on Sept 23rd [[Projects/Lark/Lark log, 2026-09-21], [Projects/Lark/Lark log, 2026-09-23]]. You also sent the first **TestFlight build** to 12 testers and found a crash on iOS 17.0 when a habit has no icon [[Projects/Lark/Lark log, 2026-09-25]]. Did that widget fix make it into v0.8?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 75%, named in answer true, sources correct true, honest —, language ok — ungrounded claim

**Timings:** TTFT 14.6 s, total 43.8 s, search 0.0 s, 5.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** **notes** · “What's the capital of Australia?” · en: Australia · 8.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no note about the capital of Australia. Would you like to add a fact here so I never miss it again?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 12.9 s, total 16.8 s, search 8.5 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · PASS

**Question:** What did I write about my trip to Japan?

**Router:** **notes** · “What did I write about my trip to Japan?” · en: Japan · ru: Япония · 8.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no records regarding a trip to Japan. Did you perhaps save those details under a different title or date range?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 13.2 s, total 17.1 s, search 8.8 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-ru-netflix · not-in-vault · PASS

**Question:** Что я решил про подписку на Netflix?

**Router:** **notes** · “Что я решил про подписку на Netflix?” · en: Netflix · ru: Netflix · 9.6 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.83)

**Answer:**

> В хранилище нет информации о вашем решении касательно подписки на Netflix. Есть запись только об идеях по монетизации проекта Lark: вы решили отказаться от подписок и рекламы в пользу разовой покупки за 12 евро или «чаевых» (отметка из Идеи по монетизации Lark).

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 16.0 s, total 27.3 s, search 9.6 s, 6.4 tokens/s

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

> Hello. I am Recto, your keeper. Would you like to explore a folder or ask about something in your vault?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.4 s, total 8.4 s, search 0.0 s, 6.5 tokens/s

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

> Рады помочь! Есть ли у вас сейчас тема или период в заметках, которые вы хотели бы обсудить?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.2 s, total 7.7 s, search 0.0 s, 7.2 tokens/s

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

> Nothing recorded yet in the vault regarding this comment. Do you wish to save a note about your mood or context?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.0 s, total 7.3 s, search 0.0 s, 7.2 tokens/s

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

> I am Recto, a vault keeper within this conversation context. I have not seen any note regarding my specific model architecture in your records. Did you intend to store that detail elsewhere?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.0 s, total 9.4 s, search 0.0 s, 7.0 tokens/s

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

> Мои записи охватывают период с **1928 по 1937 год**. Я могу рассказать подробнее об этом времени или других периодах, если они упомянуты в моих записях. Есть ли конкретный момент, который вас интересует?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.3 s, total 12.4 s, search 0.0 s, 6.8 tokens/s

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

> No; your notes remain within this vault and are not sent elsewhere. Do you have any specific note in mind regarding their storage or safety?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.1 s, total 8.1 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
