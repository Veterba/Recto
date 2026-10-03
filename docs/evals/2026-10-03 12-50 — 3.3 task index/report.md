---
run_id: "2026-10-03 12-50 — 3.3 task index"
date: 2026-10-03T10:50:51.679Z
model: qwen3.5:9b
commit: 0bca99b (dirty)
report_version: 1
compared_to: "2026-10-03 12-38 — 3.2 router"
---

# Recto Eval: 3.3 task index

## Summary

Compared to "2026-10-03 12-38 — 3.2 router", what changed: taskIndex on, looseTasks on. 22 of 38 cases pass (58%), recall@4 45%, time to first token 12.4 s at the median (p90 19.3 s), 6.5 tokens/s. Pass rate 37% → 58%, recall@4 31% → 45%, TTFT p50 9.3 s → 12.4 s. Biggest win: tasks (▲ +86 pt). No kind got worse.

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 7.8 tokens/s (a throttling Mac shows under 5)
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

- **recall@4**: 45%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 38%. The answer names at least one expected note by title.
- **sources-correct**: 63%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 100%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 87%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self); — before the router exists.
- **ungrounded claims**: 2. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 12.4 s, p90 19.3 s — from the question to the first token, including the vault search.
- **total time** p50 19.7 s, p90 28.4 s — from the question to the last token.
- **tokens/sec**: 6.5. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.0 GB resident, the model 5.8 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.4 GB; swap used 6.3 GB before → 6.6 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 3/6 (50%) | 50% | — | 83% | 33% | 50% | — | 1 |
| cross-language | 6 | 0/6 (0%) | 0% | — | 83% | 0% | 0% | — | 0 |
| named-note | 4 | 2/4 (50%) | 50% | — | 50% | 75% | 50% | — | 1 |
| follow-up | 2 | 0/2 (0%) | 0% | — | 100% | 50% | 0% | — | 0 |
| recent | 4 | 2/4 (50%) | 52% | 100% | 100% | 0% | 100% | — | 0 |
| tasks | 7 | 7/7 (100%) | 87% | 100% | 100% | 71% | 100% | — | 0 |
| not-in-vault | 3 | 2/3 (67%) | — | — | 67% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 22/38 (58%) | 45% | 100% | 87% | 38% | 63% | 100% | 2 |

## Compared to 2026-10-03 12-38 — 3.2 router

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 3/6 (50%) (=) | 50% ▼ -17 pt | — | 83% | 33% | 50% ▼ -17 pt | — | 1 (was 0) |
| cross-language | 6 | 0/6 (0%) (=) | 0% ▼ -17 pt | — | 83% | 0% | 0% ▼ -17 pt | — | 0 (was 0) |
| named-note | 4 | 2/4 (50%) (=) | 50% (=) | — | 50% | 75% | 50% (=) | — | 1 (was 1) |
| follow-up | 2 | 0/2 (0%) (=) | 0% (=) | — | 100% | 50% | 0% (=) | — | 0 (was 0) |
| recent | 4 | 2/4 (50%) ▲ +50 pt | 52% ▲ +52 pt | 100% ▲ +100 pt | 100% | 0% | 100% ▲ +100 pt | — | 0 (was 0) |
| tasks | 7 | 7/7 (100%) ▲ +86 pt | 87% ▲ +58 pt | 100% ▲ +80 pt | 100% | 71% | 100% ▲ +71 pt | — | 0 (was 0) |
| not-in-vault | 3 | 2/3 (67%) (=) | — | — | 67% | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| **overall** | 38 | 22/38 (58%) ▲ +21 pt | 45% ▲ +14 pt | 100% ▲ +83 pt | 87% | 38% | 63% ▲ +20 pt | 100% | 2 (was 1) |

- pass → fail: none
- fail → pass: `recent-ru-since-monday`, `tasks-open-last-week`, `tasks-done`, `tasks-ru-overdue`, `tasks-real-ru-last-week`, `tasks-open-wednesday`, `tasks-en-finished-last-week`, `recent-what-did-i-do`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 13.8 s | 21.5 s | 23.8 s | 28.4 s | 6.3 |
| cross-language | 12.7 s | 16.5 s | 18.4 s | 23.6 s | 7.0 |
| named-note | 16.5 s | 22.4 s | 25.2 s | 34.6 s | 6.1 |
| follow-up | 18.0 s | 19.6 s | 23.9 s | 26.6 s | 6.7 |
| recent | 15.1 s | 18.4 s | 26.6 s | 40.1 s | 6.2 |
| tasks | 4.6 s | 7.0 s | 15.0 s | 22.8 s | 6.0 |
| not-in-vault | 10.8 s | 16.5 s | 20.0 s | 21.0 s | 6.7 |
| small-talk | 1.2 s | 1.3 s | 4.9 s | 6.5 s | 7.0 |
| self | 1.2 s | 1.2 s | 8.1 s | 9.3 s | 7.2 |
| **overall** | 12.4 s | 19.3 s | 19.7 s | 28.4 s | 6.5 |

## Error analysis

- `named-beta-feedback` (named-note) — ignored named note: expected Beta feedback; read 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24; ungrounded claim: named “Beta feedback” without having it; wrong route: router said tasks
- `named-ru-plan-platform` (named-note) — ignored named note: expected Lark plan; read 2026-09-21, Write privacy policy, App Store screenshots, Localise into Norwegian; wrong route: router said tasks
- `same-half-marathon` (same-language) — wrong note: expected Running plan; read 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24; ungrounded claim: named “Deep Work” without having it; wrong route: router said tasks
- `follow-ru-tbilisi-food` (follow-up) — retrieval miss: expected Тбилиси; read nothing
- `recent-wednesday` (recent) — wrong note: expected 2026-09-23 — v0.7; read 2026-09-21, 2026-09-23, 2026-09-21 — v0.6, 2026-09-22

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 8 |
| wrong note | 5 |
| ignored named note | 2 |
| ungrounded claim | 2 |
| wrong route | 5 |

## Appendix: cases

### same-sourdough-ratio · same-language · PASS

**Question:** What's the feeding ratio for my sourdough starter?

**Router:** **notes** · “What's the feeding ratio for my sourdough starter?” · named: sourdough starter · 12.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.50)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 4.50)

**Answer:**

> Your current routine uses a **1:5:5** ratio (10 g starter to 50 g flour and water), with half rye and half white bread flour, fed once daily. This is your standard since September 2026. Do you need that for today's feed?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 18.9 s, total 28.4 s, search 12.2 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · FAIL

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** **tasks** · “When is my half marathon, and what time am I aiming for?” · named: half marathon · 7.3 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-28, 2026-09-29, Экспорт +7

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.90)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.80)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.70)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.60)
- 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 2.50)
- 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.40)
- Экспорт (`Projects/Lark/Экспорт.md`, score 2.30)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.20)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.10)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.00)
- Weekly goals (`tasks/Weekly goals.md`, score 1.90)
- 2026-09-17 (`Daily/2026/09/W38/2026-09-17.md`, score 1.80)
- 2026-09-18 (`Daily/2026/09/W38/2026-09-18.md`, score 1.70)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 1.60)

**Answer:**

> The vault does not contain information about a scheduled half marathon or target times. Did you perhaps record this in the notes under "Deep Work" or another topic from that period?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, ungrounded claim, wrong route

**Timings:** TTFT 21.5 s, total 26.7 s, search 13.5 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-chain-wear · same-language · PASS

**Question:** What's the wear limit for my 11-speed chain?

**Router:** **notes** · “What's the wear limit for my 11-speed chain?” · named: wear limit · 7.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Chain (`Long/Bike maintenance manual.md`, score 5.83)

**Answer:**

> The wear limit is **0.5% elongation**. This comes from *Long/Bike maintenance manual.md › Chain*. Measure it every 500 km with a chain checker to catch this early. When do you usually check your current mileage?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.5 s, total 23.8 s, search 7.3 s, 6.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-emergency-fund · same-language · PASS

**Question:** Сколько мне нужно накопить на подушку безопасности?

**Router:** **notes** · “Сколько мне нужно накопить на подушку безопасности?” · ru: подушка безопасности · 7.7 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Подушка безопасности › Подушка безопасности (`Финансы/Подушка безопасности.md`, score 6.00)

**Answer:**

> Вам нужно накопить **540 000 рублей** (это расходы около 90 000 руб/мес за 6 месяцев). Сейчас у вас есть 310 000. Хотите, я напомню про это на следующем собрании?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 13.5 s, total 23.8 s, search 7.7 s, 5.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-sleep · same-language · FAIL

**Question:** Во сколько мне лучше ложиться спать?

**Router:** **notes** · “Во сколько мне лучше ложиться спать?” · ru: сон · 7.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет записей о вашем режиме сна или времени отхода ко сну. Вы хотели бы добавить это в заметки, чтобы я мог следить за вашим распорядком дня?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 12.3 s, total 19.3 s, search 7.5 s, 6.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-no-course · same-language · FAIL

**Question:** Hvilke dager har jeg norskkurs?

**Router:** **notes** · “Hvilke dager har jeg norskkurs?” · named: norskkurs · 8.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Hytteturen › Hytteturen (`Norsk/Hytteturen.md`, score 2.83)

**Answer:**

> Jeg fant ingen noter om å gå på norskkurs i hyttenotene din; de fokuserer kun på turplanlegging, utstyr og matdeling til Hemsedal. Har du kanskje hukket deg for en annen note eller plan?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 13.8 s, total 22.5 s, search 8.2 s, 6.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** · “Что я решил про уведомления в Lark?” · ru: уведомления, Lark · 9.9 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет записей о ваших решениях относительно уведомлений в Lark. Вы хотите добавить заметку об этом или обсудить другой аспект приложения?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 14.6 s, total 19.7 s, search 10.0 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-sourdough · cross-language · FAIL

**Question:** Какое соотношение при кормлении закваски я сейчас использую?

**Router:** **notes** · “Какое соотношение при кормлении закваски я сейчас использую?” · ru: закваска · 9.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет записей о вашем текущем соотношении кормления закваски. Вы когда-нибудь писали об этом в своих заметках?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 13.7 s, total 18.4 s, search 9.2 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-marathon · cross-language · FAIL

**Question:** Когда у меня полумарафон?

**Router:** **tasks** · “Когда у меня полумарафон?” · en: half marathon · 6.8 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-28, 2026-09-29, Экспорт +7

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.90)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.80)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.70)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.60)
- 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 2.50)
- 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.40)
- Экспорт (`Projects/Lark/Экспорт.md`, score 2.30)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.20)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.10)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.00)
- Weekly goals (`tasks/Weekly goals.md`, score 1.90)
- 2026-09-17 (`Daily/2026/09/W38/2026-09-17.md`, score 1.80)
- 2026-09-18 (`Daily/2026/09/W38/2026-09-18.md`, score 1.70)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 1.60)

**Answer:**

> В заметках на период с 17 по 30 сентября нет упоминаний о датах или планах по полумарафону. Когда вы планируете пробежать его, я запомню это для вас.

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, wrong route

**Timings:** TTFT 16.5 s, total 23.6 s, search 6.8 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-borscht · cross-language · FAIL

**Question:** How long do I bake the beets for borscht?

**Router:** **notes** · “How long do I bake the beets for borscht?” · named: baking time for beets · 8.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain information on how to prepare or bake beets for borscht. Were you perhaps looking at a different recipe note regarding root vegetables?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 12.7 s, total 17.6 s, search 8.1 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-kitchen · cross-language · FAIL

**Question:** Who is doing my kitchen renovation and what's the budget?

**Router:** **notes** · “Who is doing my kitchen renovation and what's the budget?” · named: kitchen renovation · 7.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain information about your kitchen renovation or its budget. Would you like to add those details now?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 11.6 s, total 14.9 s, search 7.3 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-monetisation · cross-language · FAIL

**Question:** How did I decide to make money with Lark?

**Router:** **notes** · “How did I decide to make money with Lark?” · named: How did I decide to make money with Lark · 8.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I cannot find any notes in your vault regarding how you decided to make money with Lark or details about that specific business plan. Would you like to add those thoughts here so Recto can remember them for next time?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 12.4 s, total 19.3 s, search 8.2 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · FAIL

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **tasks** · “Look in Beta feedback - what do testers ask for most?” · en: Beta feedback · 7.6 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-28, 2026-09-29, Экспорт +7

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.90)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.80)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.70)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.60)
- 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 2.50)
- 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.40)
- Экспорт (`Projects/Lark/Экспорт.md`, score 2.30)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.20)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.10)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.00)
- Weekly goals (`tasks/Weekly goals.md`, score 1.90)
- 2026-09-17 (`Daily/2026/09/W38/2026-09-17.md`, score 1.80)
- 2026-09-18 (`Daily/2026/09/W38/2026-09-18.md`, score 1.70)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 1.60)

**Answer:**

> The vault does not contain information about tester requests or the "Beta feedback" folder; only a task index from late September 2026 is available. Did you mean to look at notes regarding Lark's privacy policy or App Store screenshots instead?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — ignored named note, ungrounded claim, wrong route

**Timings:** TTFT 16.5 s, total 25.2 s, search 7.6 s, 6.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · FAIL

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **tasks** · “Посмотри в Lark plan, какая платформа первая?” · en: Lark · 7.5 s

**Steps:** —

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: 2026-09-21, Write privacy policy, App Store screenshots, Localise into Norwegian, Weekly goals, VoiceOver labels, Fix widget crash on iOS 17

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.90)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.80)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.70)
- Weekly goals (`tasks/Weekly goals.md`, score 2.60)
- VoiceOver labels (`tasks/VoiceOver labels.md`, score 2.50)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 2.40)

**Answer:**

> Список задач на 21–30 сентября не содержит упоминаний о платформе «Lark», их очередности или приоритетах (источник: *The user's tasks*). Могу ли я помочь с другими задачами из вашего плана?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — ignored named note, wrong route

**Timings:** TTFT 14.3 s, total 22.9 s, search 7.6 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · named: Sourdough starter · 8.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 6.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.25)
- Bike maintenance manual › Cassette (`Long/Bike maintenance manual.md`, score 4.08)
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 4.08)

**Answer:**

> Before switching your current routine, you fed your sourdough twice a day at a 1:1:1 ratio (50 g starter, 50 g flour, 50 g water). This came from [[Sourdough starter (old)]]. Do you want to know why that specific frequency caused it to peak in only three hours?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 22.4 s, total 34.6 s, search 8.1 s, 6.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · PASS

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** **notes** · “In Deep Work, how many hours of deep work a day did I aim for?” · named: Deep Work · 8.1 s

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

> You aimed for four hours of deep work per day. This comes from your takeaways in *Deep Work* (Reading/Deep Work.md). Did you try to schedule those blocks today on September 18th?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 19.3 s, total 27.3 s, search 8.1 s, 5.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** · “And where did I write that down?” · named: notifications · 7.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 2.75)
- Bike maintenance manual › Pedals (`Long/Bike maintenance manual.md`, score 2.75)

**Answer:**

> I don't have any notes on your decisions regarding Lark notifications in the vault yet. Did you intend to save those details here?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 19.6 s, total 23.9 s, search 7.8 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · FAIL

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** · “А где мы там ели?” · ru: Тбилиси · 12.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Вы упоминали, что хотели заглянуть на кухню у Давида и попробовать чанакхулы, но не уточняли местоположение других ресторанов или кафе в Тбилиси во время этой поездки. Вы планировали отмечать там какие-то события?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 18.0 s, total 26.6 s, search 12.2 s, 6.8 tokens/s

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

> Last week you shipped the **v0.6 Onboarding redesign**, replacing a five-screen tutorial with one screen to pick up habits, which dropped first-day drop-off from 40% to 18%. You also delivered **v0.7** on September 23 adding dark mode and VoiceOver accessibility (warm greys, amber accent), fixed the streak counter contrast, and prepared six App Store screenshots for light/dark modes. Additionally, you sent a TestFlight beta build with v0.8 to 12 testers on September 25.
> 
> *Note: You also bought Anna's birthday gift this week; did she mention what kind of present she wants?*

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 33%, named in answer false, sources correct true, honest —, language ok — retrieval miss

**Timings:** TTFT 18.4 s, total 40.1 s, search 0.0 s, 6.4 tokens/s

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

> On Wednesday (September 23), you worked on Dark mode and VoiceOver accessibility for the app, including adding labels to every control and fixing contrast issues. You also had a scheduled one-on-one with Maria regarding her payments document. Did this discussion about Maria's payments resolve any specific concerns from your earlier review?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct true, honest —, language ok — wrong note

**Timings:** TTFT 15.1 s, total 24.2 s, search 0.0 s, 7.0 tokens/s

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

> С понедельника (28 сентября) была исправлена ошибка краша виджета на iOS 17 и начат черновик политики конфиденциальности. Также был собран бэктафиб от пользователей: самый частый запрос — добавить настройки «трижды в неделю» вместо ежедневных привычек, а Kari попросил версию для норвежского языка.
> 
> Хотите ли вы помочь с формулировками для этой новой функции?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 8.7 s, total 26.6 s, search 0.0 s, 5.6 tokens/s

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

> Still open: "Write privacy policy" (due 26 Sep), App Store screenshots, Localise into Norwegian. Done: VoiceOver labels, Fix widget crash on iOS 17. What part of the backlog feels most urgent for you today?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 67%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 7.0 s, total 15.0 s, search 0.2 s, 6.5 tokens/s

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

> Done: VoiceOver labels; Fix widget crash on iOS 17 (from the task index). Would you like to see what remains open as well?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 3.6 s, total 8.7 s, search 0.0 s, 6.2 tokens/s

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

> Просрочена задача «Write privacy policy» (срок 26 сен — не начато) из раздела Просрочено:1). Есть ли у вас время начать её сегодня?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 2.9 s, total 9.8 s, search 0.0 s, 6.1 tokens/s

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

> Срочные задания на 2026-09-21 и позже: «Write Lark privacy policy» (просрочно), «Разобрать фото из Лиссабона», «Записаться к стоматологу; Try the new interval session», «Отправить отчёт по расходам», «Order fibre internet for the new flat».
> Хотите узнать, что уже сделано за этот период?

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 75%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 6.3 s, total 22.8 s, search 0.0 s, 5.5 tokens/s

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

> Still open (6): • 23 Sep - Write Lark privacy policy; Разобрать фото из Лиссабона; Записаться к стоматологу; Try the new interval session Cards: Write privacy policy (to do, due 26 Sep - overdue); App Store screenshots (in progress, due 3 Oct). Which of these would you like to tackle first?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 3.6 s, total 18.5 s, search 0.0 s, 5.4 tokens/s

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

> Last week you finished: VoiceOver labels; 24 Sep - Review Maria's payments doc; 25 Sep - Купить подарок Ане на день рождения; Fix widget crash on iOS 17; and Long run 16 km (from the task index). Did any of these trigger new thoughts for your open tasks?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 67%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 18.6 s, search 0.4 s, 5.3 tokens/s

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

> Не доделано про «экспорту» (2): Экспорт — надо доделать экспорт в JSON; проверить, как экспорт работает с часовыми поясами (без чекбокса). Нужно ли уточнить детали реализации этих пунктов?

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.6 s, total 12.0 s, search 0.5 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-what-did-i-do · recent · PASS

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

> Last week you shipped the Lark onboarding redesign (v0.6), which replaced five screens with one to reduce drop-offs, added dark mode and VoiceOver accessibility features in v0.7, sent a TestFlight beta build that crashed on iOS 17.0 without an icon for some habits, bought Anna's birthday gift, ran a 16 km long run, and reviewed Maria's payments document (from notes dated Sept 21–27). Did you want to know more about any of these tasks?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 16.1 s, total 34.6 s, search 0.0 s, 5.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** **notes** · “What's the capital of Australia?” · named: What's the capital of Australia? · 8.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain information about Australian capitals. Would you like to note that Canberra is its actual capital instead?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 9.8 s, total 13.2 s, search 8.2 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · FAIL

**Question:** What did I write about my trip to Japan?

**Router:** **recent** · “What did I write about my trip to Japan?” · en: write, trip, japan · 0.0 s

**Steps:** —

**Tool calls:** 
- `notes_in_period(2026-09-24, 2026-09-30)` by the harness → 12 notes: 2026-09-24, 2026-09-25, 2026-09-27, 2026-09-28, 2026-09-29, 2026-09-30, 2026-09-25 — v0.8: TestFlight beta, 2026-09-28 — v0.9: Widget crash fixed +4

**Notes in context:**
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 3.00)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.90)
- 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 2.80)
- 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 2.70)
- 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.60)
- 2026-09-30 (`Daily/2026/09/W40/2026-09-30.md`, score 2.50)
- 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 2.40)
- 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 2.30)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.20)
- Fix widget crash on iOS 17 (`tasks/Fix widget crash on iOS 17.md`, score 2.10)
- Weekly goals (`tasks/Weekly goals.md`, score 2.00)
- Экспорт (`Projects/Lark/Экспорт.md`, score 1.90)

**Answer:**

> I don't have any notes written about a trip to Japan in the vault for you yet. Did you perhaps mean your recent photos from Lisbon?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok — wrong route

**Timings:** TTFT 16.5 s, total 21.0 s, search 0.0 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-ru-netflix · not-in-vault · PASS

**Question:** Что я решил про подписку на Netflix?

**Router:** **notes** · “Что я решил про подписку на Netflix?” · ru: Netflix · 8.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.83)

**Answer:**

> В текущем контексте нет информации о вашем решении относительно подписки на Netflix (есть только заметки об отказе от подписок для проекта Lark). Вы случайно не перепутали сервисы или забыли записать эту мысль в заметках про монетизацию?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 10.8 s, total 20.0 s, search 8.2 s, 6.3 tokens/s

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

> Hello. I am Recto, keeper of this vault. What would you like to explore within your own notes today?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.3 s, total 4.9 s, search 0.0 s, 6.9 tokens/s

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

> Добро пожаловать в хранилище ваших заметок. У вас есть идеи для следующей темы или вы хотите просмотреть что-то из ранее сохраненного?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.2 s, total 6.5 s, search 0.0 s, 6.8 tokens/s

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

> Nothing specific to retrieve yet; your vault is empty so far. Did you write down a topic or idea while we were chatting?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.2 s, total 4.9 s, search 0.0 s, 7.2 tokens/s

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

> I am Recto, a vault keeper focused solely on your notes and context. I cannot answer this question from my internal identity or training data, as that information is not in the vault provided to me. Do you have any specific notes about models or systems we should discuss instead?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.2 s, total 9.3 s, search 0.0 s, 7.0 tokens/s

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

> В хранилище нет информации о том, из каких именно лет поступили записи; контекст не содержит датировки для этого вопроса. Вы когда-нибудь фиксировали в заметках период времени или год создания конкретной идеи?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.2 s, total 7.9 s, search 0.0 s, 7.2 tokens/s

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

> I do not have access to information about how your data is transmitted or stored outside this session; I only know what you type here and what was provided in my current context. Did you intend to ask if a specific note mentions where something has been sent?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.2 s, total 8.1 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
