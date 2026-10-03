---
run_id: "2026-10-03 13-01 — 3.2 router, fixed"
date: 2026-10-03T11:01:48.431Z
model: qwen3.5:9b
commit: 0bca99b (dirty)
report_version: 1
compared_to: "2026-10-03 12-50 — 3.3 task index"
---

# Recto Eval: 3.2 router, fixed

## Summary

Compared to "2026-10-03 12-50 — 3.3 task index", what changed: taskIndex off, looseTasks off. 24 of 38 cases pass (63%), recall@4 53%, time to first token 9.5 s at the median (p90 17.4 s), 7.6 tokens/s. Pass rate 58% → 63%, recall@4 45% → 53%, TTFT p50 12.4 s → 9.5 s. Biggest win: same-language (▲ +50 pt). Biggest regression: tasks (▼ -86 pt).

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 11.2 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"qwen3.5","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router on, taskIndex off, looseTasks off, hybridRetrieval off, namedNotes off, tools off, stickyContext off, steps off
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

- **recall@4**: 53%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 38%. The answer names at least one expected note by title.
- **sources-correct**: 63%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 17%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 100%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self); — before the router exists.
- **ungrounded claims**: 1. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 9.5 s, p90 17.4 s — from the question to the first token, including the vault search.
- **total time** p50 13.7 s, p90 26.9 s — from the question to the last token.
- **tokens/sec**: 7.6. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.4 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.4 GB; swap used 7.1 GB before → 7.0 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) | 100% | — | 100% | 67% | 100% | — | 0 |
| cross-language | 6 | 3/6 (50%) | 42% | — | 100% | 50% | 50% | — | 1 |
| named-note | 4 | 4/4 (100%) | 100% | — | 100% | 75% | 100% | — | 0 |
| follow-up | 2 | 1/2 (50%) | 50% | — | 100% | 0% | 50% | — | 0 |
| recent | 4 | 0/4 (0%) | 0% | 0% | 100% | 0% | 0% | — | 0 |
| tasks | 7 | 1/7 (14%) | 29% | 20% | 100% | 14% | 29% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | 100% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 24/38 (63%) | 53% | 17% | 100% | 38% | 63% | 100% | 1 |

## Compared to 2026-10-03 12-50 — 3.3 task index

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) ▲ +50 pt | 100% ▲ +50 pt | — | 100% | 67% | 100% ▲ +50 pt | — | 0 (was 1) |
| cross-language | 6 | 3/6 (50%) ▲ +50 pt | 42% ▲ +42 pt | — | 100% | 50% | 50% ▲ +50 pt | — | 1 (was 0) |
| named-note | 4 | 4/4 (100%) ▲ +50 pt | 100% ▲ +50 pt | — | 100% | 75% | 100% ▲ +50 pt | — | 0 (was 1) |
| follow-up | 2 | 1/2 (50%) ▲ +50 pt | 50% ▲ +50 pt | — | 100% | 0% | 50% ▲ +50 pt | — | 0 (was 0) |
| recent | 4 | 0/4 (0%) ▼ -50 pt | 0% ▼ -52 pt | 0% ▼ -100 pt | 100% | 0% | 0% ▼ -100 pt | — | 0 (was 0) |
| tasks | 7 | 1/7 (14%) ▼ -86 pt | 29% ▼ -58 pt | 20% ▼ -80 pt | 100% | 14% | 29% ▼ -71 pt | — | 0 (was 0) |
| not-in-vault | 3 | 3/3 (100%) ▲ +33 pt | — | — | 100% | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| **overall** | 38 | 24/38 (63%) ▲ +5 pt | 53% ▲ +8 pt | 17% ▼ -83 pt | 100% | 38% | 63% (=) | 100% | 1 (was 2) |

- pass → fail: `recent-ru-since-monday`, `tasks-open-last-week`, `tasks-done`, `tasks-ru-overdue`, `tasks-real-ru-last-week`, `tasks-open-wednesday`, `tasks-en-finished-last-week`, `recent-what-did-i-do`
- fail → pass: `same-half-marathon`, `same-ru-sleep`, `same-no-course`, `cross-ru-en-sourdough`, `cross-ru-en-marathon`, `cross-en-ru-monetisation`, `named-beta-feedback`, `named-ru-plan-platform`, `follow-ru-tbilisi-food`, `notin-japan`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 15.1 s | 19.6 s | 22.4 s | 31.4 s | 7.1 |
| cross-language | 13.3 s | 16.9 s | 21.4 s | 26.9 s | 7.0 |
| named-note | 16.7 s | 21.8 s | 22.1 s | 27.8 s | 7.8 |
| follow-up | 12.7 s | 15.7 s | 19.4 s | 20.1 s | 7.7 |
| recent | 2.6 s | 4.8 s | 9.4 s | 10.2 s | 7.7 |
| tasks | 2.5 s | 4.4 s | 9.8 s | 13.7 s | 7.8 |
| not-in-vault | 9.5 s | 11.1 s | 13.2 s | 19.4 s | 8.1 |
| small-talk | 1.6 s | 2.0 s | 4.6 s | 6.2 s | 8.4 |
| self | 1.8 s | 1.8 s | 7.5 s | 9.1 s | 7.4 |
| **overall** | 9.5 s | 17.4 s | 13.7 s | 26.9 s | 7.6 |

## Error analysis

- `cross-ru-en-notifications` (cross-language) — wrong note: expected Lark plan; read Идеи по монетизации, Lark log; ungrounded claim: named “2026-09-15 — v0.4” without having it
- `cross-en-ru-borscht` (cross-language) — retrieval miss: expected Борщ; read nothing
- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Bike maintenance manual
- `cross-en-ru-kitchen` (cross-language) — retrieval miss: expected Ремонт кухни; read nothing
- `tasks-open-last-week` (tasks) — wrong note: expected App Store screenshots, Localise into Norwegian, VoiceOver labels; read Lark ideas, Lark plan

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 6 |
| wrong note | 7 |
| missing items | 5 |
| decoy in context | 1 |
| ungrounded claim | 1 |

## Appendix: cases

### same-sourdough-ratio · same-language · PASS

**Question:** What's the feeding ratio for my sourdough starter?

**Router:** **notes** · “What's the feeding ratio for my sourdough starter?” · en: sourdough starter · ru: закваска · 10.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.50)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 4.50)

**Answer:**

> The current routine uses a **1:5:5** ratio (10 g starter, 50 g flour, 50 g water). This involves half rye and half white bread flour.
> *Source: Sourdough starter.md › Current routine*
> 
> Would you like to know how the feeding changes for long trips?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.1 s, total 22.1 s, search 10.8 s, 10.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · PASS

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** **notes** · “When is my half marathon, and what time am I aiming for?” · en: half marathon · 7.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Your goal is the Oslo half marathon on 8 November 2026 with a target time under 1:50 (from *Running plan*). Did you want to see how this timeline aligns with your current training schedule?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 11.9 s, total 18.3 s, search 7.1 s, 7.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-chain-wear · same-language · PASS

**Question:** What's the wear limit for my 11-speed chain?

**Router:** **notes** · “What's the wear limit for my 11-speed chain?” · en: wear limit, chain · 10.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Chain (`Long/Bike maintenance manual.md`, score 5.83)

**Answer:**

> For an 11-speed chain, the wear limit is **0.5% elongation**. Check your specific note: *"The wear limit for an 11-speed chain is 0.5% elongation"* (from Bike maintenance manual). Do you have a chain checker handy to verify this?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 19.6 s, total 31.4 s, search 10.3 s, 5.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-emergency-fund · same-language · PASS

**Question:** Сколько мне нужно накопить на подушку безопасности?

**Router:** **notes** · “Сколько мне нужно накопить на подушку безопасности?” · en: emergency fund · ru: подушка безопасности · 11.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Подушка безопасности › Подушка безопасности (`Финансы/Подушка безопасности.md`, score 6.00)

**Answer:**

> Вам необходимо накопить **540 000 рублей**, что составляет расходы за шесть месяцев (6 × ~90 000 руб.). Сейчас у вас сформировано только 310 000. Хотите узнать, сколько времени потребуется дойти до цели при текущем темпе откладывания?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 17.7 s, total 30.1 s, search 11.3 s, 5.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-sleep · same-language · PASS

**Question:** Во сколько мне лучше ложиться спать?

**Router:** **notes** · “Во сколько мне лучше ложиться спать?” · en: sleep · ru: сон · 8.7 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Сон › Сон (`Здоровье/Сон.md`, score 3.00)

**Answer:**

> Лучше ложиться до 23:30, чтобы вставать в 7:00 даже в выходные; при этом вы спите около 7,5 часов и просыпаетесь без будильника. Хотите попробовать этот режим завтра вечером?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 14.1 s, total 22.4 s, search 8.7 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-no-course · same-language · PASS

**Question:** Hvilke dager har jeg norskkurs?

**Router:** **notes** · “Hvilke dager har jeg norskkurs?” · en: Norwegian course · ru: норвежский курс · 9.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Norskkurs › Norskkurs (`Norsk/Norskkurs.md`, score 3.00)
- Hytteturen › Hytteturen (`Norsk/Hytteturen.md`, score 2.83)

**Answer:**

> Du har norskkurstirsdager og torsdager kl. 18.00–20.00 hos Folkeuniversitetet (lærer: Ingrid). *Har du allerede planlagt hvordan vi skal øve på muntlig norsk mellom disse time?*

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.3 s, total 23.8 s, search 9.2 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** · “Что я решил про уведомления в Lark?” · en: Lark notifications · ru: уведомления Lark · 8.9 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.58)
- Lark log › Entries (`Projects/Lark/Lark log.md`, score 2.58)

**Answer:**

> Вы решили не использовать подписки и рекламу для трекера привычек, чтобы приложение оставалось простым; уведомление о том, что функционал включает их обработку, указано в заметке [[2026-09-15 — v0.4]].
> 
> Хотите узнать детали реализации этих уведомлений из лога разработки?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, ungrounded claim

**Timings:** TTFT 16.9 s, total 26.9 s, search 8.9 s, 7.1 tokens/s

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

> Сейчас используется разовая подкормка в соотношении **1:5:5** (10 г закваски, 50 г муки, 50 г воды) [Sourdough starter].

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.6 s, total 23.6 s, search 9.1 s, 7.1 tokens/s

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

> Ваш полумарафон запланирован на **8 ноября 2026 года** в Осло (цель — финиш быстрее 1:50) [Running plan]. Хотите ли вы обсудить текущий график подготовки к этой дате?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 13.3 s, total 21.4 s, search 8.4 s, 6.9 tokens/s

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

> The note "Borscht Recipe" states to bake beets until tender, approximately 45–60 minutes at 375°F (190°C). Would you like me to summarize the full preparation steps from that recipe instead?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 12.8 s, total 20.2 s, search 8.8 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-kitchen · cross-language · FAIL

**Question:** Who is doing my kitchen renovation and what's the budget?

**Router:** **notes** · “Who is doing my kitchen renovation and what's the budget?” · en: kitchen renovation · 9.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no information about your kitchen renovation or its budget. Did you perhaps save those details under a different project folder?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 13.3 s, total 16.8 s, search 9.2 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-monetisation · cross-language · PASS

**Question:** How did I decide to make money with Lark?

**Router:** **notes** · “How did I decide to make money with Lark?” · en: Lark · 10.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark plan › Streak rules (`Projects/Lark/Lark plan.md`, score 2.70)

**Answer:**

> The vault contains no notes explaining how you decided to monetize or make money with Lark; it only details the "Streak rules" for habit tracking within the project (found in `Projects/Lark/Lark plan.md › Streak rules`). Do you recall if we discussed a specific revenue model elsewhere?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 50%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.0 s, total 24.2 s, search 10.2 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · PASS

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **notes** · “Look in Beta feedback - what do testers ask for most?” · en: Beta feedback · 9.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Beta feedback › Beta feedback (`Projects/Lark/Beta feedback.md`, score 5.70)
- Localise into Norwegian › Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 4.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 3.53)
- 2026-09-25 — v0.8: TestFlight beta › 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.58)

**Answer:**

> The weekly goals feature is by far the most requested, asked by 7 of the 12 testers [[Beta feedback]]. Would you like to prioritize implementing that next?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 17.4 s, total 22.1 s, search 9.1 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · PASS

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **notes** · “Посмотри в Lark plan, какая платформа первая?” · en: Lark · 9.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 2.53)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 2.44)
- Lark plan › Release (`Projects/Lark/Lark plan.md`, score 2.53)

**Answer:**

> Первой платформой для релиза является iPhone; бета-тестирование через TestFlight запланировано на конец сентября (note: [[Lark plan]]). Планируется ли также выпуск версии для Android до выхода приложения 2026 года?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.0 s, total 21.9 s, search 9.4 s, 7.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · en: sourdough starter · ru: дрожжевая закваска · 8.7 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 6.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.25)
- Apartment move checklist › Apartment move checklist (`Home/Apartment move checklist.md`, score 2.83)
- Bike maintenance manual › Cassette (`Long/Bike maintenance manual.md`, score 4.08)
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 4.08)

**Answer:**

> You previously fed it twice daily at a 1:1:1 ratio using only white flour, which resulted in an overly sour taste and a peak time of just three hours. Would you like me to compare that with your current routine?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 21.8 s, total 27.8 s, search 8.8 s, 8.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · PASS

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** **notes** · “In Deep Work, how many hours of deep work a day did I aim for?” · en: Deep Work · 8.1 s

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

> You aimed for four hours of deep work per day. This comes from your takeaways on Cal Newport's book *Deep Work*, where you noted: "Aim for four hours of deep work a day; more is rarely possible." (Source: `Reading/Deep Work.md › Deep Work`)

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.7 s, total 24.5 s, search 8.2 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** · “And where did I write that down?” · named: notifications · 7.6 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 2.75)
- Bike maintenance manual › Pedals (`Long/Bike maintenance manual.md`, score 2.75)

**Answer:**

> I don't have any notes regarding your decisions on notifications in Lark in the vault. Would you like to record those details now so they are available for future reference?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 15.7 s, total 20.1 s, search 7.6 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · PASS

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** · “А где мы там ели?” · en: Tbilisi · ru: Тбилиси · 8.6 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Тбилиси › Тбилиси (`Путешествия/Тбилиси.md`, score 3.00)

**Answer:**

> Хинкали — в ресторане «Зодиак», хачапури по-аджарски — в заведении «Сакхачапуре №1». Где ещё вы хотели бы попробовать блюда тбилисской кухни?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 12.7 s, total 19.4 s, search 8.6 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-last-week · recent · FAIL

**Question:** What did I work on in Lark last week?

**Router:** **recent** · “What did I work on in Lark last week?” · en: work, lark, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 2.83)
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 2.39)
- Lark plan › Streak rules (`Projects/Lark/Lark plan.md`, score 2.34)
- Lark plan › Platform (`Projects/Lark/Lark plan.md`, score 2.34)

**Answer:**

> You worked on **Lark widgets** all day during that period (September 15). Would you like to see which specific habits were tied to those widgets?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 4.8 s, total 9.4 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-wednesday · recent · FAIL

**Question:** What did I do on Wednesday last week?

**Router:** **recent** · “What did I do on Wednesday last week?” · en: wednesd, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- 2026-09-23 › 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 3.00)
- 2026-09-30 › 2026-09-30 (`Daily/2026/09/W40/2026-09-30.md`, score 2.67)

**Answer:**

> On that Wednesday, you focused on Dark mode and VoiceOver settings (Daily/2026/09/W39). Did this work connect with your upcoming 1-1 with Maria mentioned the same day?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 3.4 s, total 9.6 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-ru-since-monday · recent · FAIL

**Question:** Что нового в Lark с понедельника?

**Router:** **recent** · “Что нового в Lark с понедельника?” · en: нового, lark, понедельни · period 2026-09-28..2026-09-30 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- 2026-09-14 › 2026-09-14 (`Daily/2026/09/W38/2026-09-14.md`, score 3.00)

**Answer:**

> В записях от понедельника (2026-09-14) указано лишь о блокировке карты после поездки; обновлений по поводу Lark не найдено. Вы интересовались изменениями именно в сервисе или, возможно, перепутали название?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 2.6 s, total 10.2 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-last-week · tasks · FAIL

**Question:** Which Lark tasks from last week are still open, and which are done?

**Router:** **tasks** · “Which Lark tasks from last week are still open, and which are done?” · en: lark, tasks, last, week, still, open · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 2.83)
- Lark plan › Streak rules (`Projects/Lark/Lark plan.md`, score 2.34)
- Lark plan › Platform (`Projects/Lark/Lark plan.md`, score 2.34)

**Answer:**

> The vault contains no records of specific tasks completed or remaining for "last week." It does contain a record that the streak rules were decided on 2026-09-09 after a test week. Do you want to check your calendar heat map in the Monthly review screen instead?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 4.4 s, total 12.7 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-done · tasks · FAIL

**Question:** Which Lark tasks are done?

**Router:** **tasks** · “Which Lark tasks are done?” · en: lark, tasks · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain any information about completed Lark tasks or related notes. Is there a specific project within your notes you'd like to review instead?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 1.8 s, total 5.9 s, search 0.0 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-ru-overdue · tasks · FAIL

**Question:** Какие задачи у меня просрочены?

**Router:** **tasks** · “Какие задачи у меня просрочены?” · en: какие, задачи, просроче · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет заметок о ваших задачах или сроках их выполнения. Вы записывали список задач с датами где-нибудь ещё?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 2.0 s, total 6.3 s, search 0.0 s, 7.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-real-ru-last-week · tasks · FAIL

**Question:** что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику

**Router:** **tasks** · “что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику” · en: додел, прошл, недели, посмот, задачи, одну, специфи · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Линейные уравнения › Линейные уравнения (`Учёба/Khan Academy/Линейные уравнения.md`, score 2.83)

**Answer:**

> Вы не завершили задачи № 9–12 из упражнения по линейным уравнениям (см. `Линейные уравнения`). Вернитесь к ним и также решите задачи на составление уравнений по условию, например, типа «Поезд вышел из города A…».

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, missing items, decoy in context

**Timings:** TTFT 3.1 s, total 11.7 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-wednesday · tasks · FAIL

**Question:** What's still open from Wednesday?

**Router:** **tasks** · “What's still open from Wednesday?” · en: still, open, wednesd · period 2026-09-23..2026-09-23 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- 2026-09-23 › 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 3.00)
- 2026-09-30 › 2026-09-30 (`Daily/2026/09/W40/2026-09-30.md`, score 2.67)

**Answer:**

> Nothing is explicitly marked as "still open" for Wednesday (September 23, 2026); the note simply mentions a 1-1 with Maria scheduled for tomorrow [Source: Daily/2026/09/W40/2026-09-30.md]. Is there anything specific you were planning to finish before that meeting?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok — missing items

**Timings:** TTFT 3.3 s, total 13.7 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-en-finished-last-week · tasks · FAIL

**Question:** Which tasks did I finish last week?

**Router:** **tasks** · “Which tasks did I finish last week?” · en: tasks, finish, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I cannot find any information about your recent tasks or what you finished last week in my records. Did we perhaps discuss a project that hasn't been saved yet, or are those notes located elsewhere?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 1.8 s, total 6.7 s, search 0.0 s, 8.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-loose-export · tasks · PASS

**Question:** Что мне ещё осталось доделать по экспорту?

**Router:** **tasks** · “Что мне ещё осталось доделать по экспорту?” · en: ещё, остало, додела, экспор · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Экспорт › Экспорт (`Projects/Lark/Экспорт.md`, score 4.50)

**Answer:**

> Осталось дописать экспорт в JSON (сейчас там нет истории отметок) и исправить работу с часовыми поясами. Также нужно успеть закончить это перед релизом 20 октября. Хочешь, я напомню про что-то ещё из заметок?

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 2.5 s, total 9.8 s, search 0.0 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-what-did-i-do · recent · FAIL

**Question:** What did I do last week?

**Router:** **recent** · “What did I do last week?” · en: last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I found no matching records regarding your actions from last week in the vault. What specific topic or period would you like to explore instead?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 1.8 s, total 5.0 s, search 0.0 s, 8.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** **notes** · “What's the capital of Australia?” · en: Australia · 7.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The available context does not contain information regarding the capital of Australia or any related geographical topics. Would you like to record a note on Australian geography for future reference here?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 8.9 s, total 13.2 s, search 7.1 s, 7.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · PASS

**Question:** What did I write about my trip to Japan?

**Router:** **notes** · “What did I write about my trip to Japan?” · en: Japan · ru: Япония · 7.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I found no notes regarding your trip to Japan. Did you perhaps save those observations under a different folder or date?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 9.5 s, total 12.2 s, search 7.8 s, 9.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-ru-netflix · not-in-vault · PASS

**Question:** Что я решил про подписку на Netflix?

**Router:** **notes** · “Что я решил про подписку на Netflix?” · en: Netflix · ru: Netflix · 7.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.83)

**Answer:**

> В записях нет информации о вашем решении касательно подписки на Netflix. У меня есть только информация о том, что вы решили не вводить подписки для приложения Lark (см. «Идеи по монетизации Lark»).
> 
> Хотите сохранить это решение отдельно?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 11.1 s, total 19.4 s, search 7.8 s, 7.3 tokens/s

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

> Hello. I am Recto, keeper of this vault. Shall we begin with your first note?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.6 s, total 3.9 s, search 0.0 s, 9.4 tokens/s

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

> Ваша благодарность зафиксирована в текущем контексте разговора. Есть ли ещё тема из заметок, которую стоит обсудить?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 2.0 s, total 6.2 s, search 0.0 s, 7.9 tokens/s

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

> That note exists in your vault under "2024/notes/haha". Would you like to expand it?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.5 s, total 4.6 s, search 0.0 s, 8.0 tokens/s

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

> I am Recto, the keeper of this vault; I answer only using the notes provided to me in my context. Do you have a specific topic or note within your collection you would like me to summarize next?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.5 s, total 7.5 s, search 0.0 s, 7.3 tokens/s

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

> Мои знания ограничены содержимым хранилища; я не могу сообщить год их создания или границы временных рамок без конкретных записей в контексте. Хотите, чтобы мы посмотрели даты в ваших заметках, если они там есть?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.8 s, total 9.1 s, search 0.0 s, 7.3 tokens/s

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

> I am Recto; I hold this vault strictly within its confines and send nothing outside it unless explicitly instructed to share with you. Do you wish to know what specific topics are stored here right now?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.8 s, total 7.2 s, search 0.0 s, 7.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
