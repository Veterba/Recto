---
run_id: "2026-10-03 12-28 — 3.1 speed"
date: 2026-10-03T10:28:01.244Z
model: qwen3.5:9b
commit: 0bca99b (dirty)
report_version: 1
compared_to: "2026-10-03 12-19 — baseline v2"
---

# Recto Eval: 3.1 speed

## Summary

Compared to "2026-10-03 12-19 — baseline v2", what changed: nothing in the setup (same model, code, prompt and cases) - differences are the model’s own variation. 16 of 38 cases pass (42%), recall@4 28%, time to first token 4.7 s at the median (p90 9.4 s), 7.1 tokens/s. Pass rate 42% → 42%, recall@4 28% → 28%, TTFT p50 5.3 s → 4.7 s. No kind got better. No kind got worse.

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 7.1 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"qwen3.5","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router off, taskIndex off, looseTasks off, hybridRetrieval off, namedNotes off, tools off, stickyContext off, steps off
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

- **recall@4**: 28%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 28%. The answer names at least one expected note by title.
- **sources-correct**: 37%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 17%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: —. The router's kind matches the case's (notes / recent / tasks / smalltalk / self); — before the router exists.
- **ungrounded claims**: 1. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 4.7 s, p90 9.4 s — from the question to the first token, including the vault search.
- **total time** p50 11.1 s, p90 17.0 s — from the question to the last token.
- **tokens/sec**: 7.1. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 6.9 GB resident, the model 5.8 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.4 GB; swap used 6.0 GB before → 6.4 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 4/6 (67%) | 67% | — | — | 67% | 67% | — | 0 |
| cross-language | 6 | 0/6 (0%) | 0% | — | — | 0% | 0% | — | 0 |
| named-note | 4 | 2/4 (50%) | 50% | — | — | 75% | 50% | — | 1 |
| follow-up | 2 | 1/2 (50%) | 50% | — | — | 0% | 50% | — | 0 |
| recent | 4 | 0/4 (0%) | 0% | 0% | — | 0% | 0% | — | 0 |
| tasks | 7 | 1/7 (14%) | 14% | 20% | — | 14% | 14% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | — | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | — | — | 100% | — | 0 |
| self | 3 | 2/3 (67%) | — | — | — | — | 67% | — | 0 |
| **overall** | 38 | 16/38 (42%) | 28% | 17% | — | 28% | 37% | 100% | 1 |

## Compared to 2026-10-03 12-19 — baseline v2

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 4/6 (67%) (=) | 67% (=) | — | — | 67% | 67% (=) | — | 0 (was 0) |
| cross-language | 6 | 0/6 (0%) (=) | 0% (=) | — | — | 0% | 0% (=) | — | 0 (was 0) |
| named-note | 4 | 2/4 (50%) (=) | 50% (=) | — | — | 75% | 50% (=) | — | 1 (was 3) |
| follow-up | 2 | 1/2 (50%) (=) | 50% (=) | — | — | 0% | 50% (=) | — | 0 (was 0) |
| recent | 4 | 0/4 (0%) (=) | 0% (=) | 0% (=) | — | 0% | 0% (=) | — | 0 (was 0) |
| tasks | 7 | 1/7 (14%) (=) | 14% (=) | 20% (=) | — | 14% | 14% (=) | — | 0 (was 0) |
| not-in-vault | 3 | 3/3 (100%) (=) | — | — | — | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | — | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 2/3 (67%) (=) | — | — | — | — | 67% (=) | — | 0 (was 0) |
| **overall** | 38 | 16/38 (42%) (=) | 28% (=) | 17% (=) | — | 28% | 37% (=) | 100% | 1 (was 3) |

- pass → fail: none
- fail → pass: none
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 5.4 s | 12.3 s | 13.7 s | 25.0 s | 7.1 |
| cross-language | 4.3 s | 4.4 s | 8.7 s | 12.3 s | 7.6 |
| named-note | 7.8 s | 13.2 s | 16.3 s | 27.7 s | 7.2 |
| follow-up | 6.7 s | 11.1 s | 15.2 s | 17.0 s | 7.2 |
| recent | 4.4 s | 5.0 s | 9.1 s | 11.5 s | 7.1 |
| tasks | 4.9 s | 5.3 s | 9.8 s | 13.5 s | 7.4 |
| not-in-vault | 4.5 s | 5.7 s | 10.0 s | 14.2 s | 6.9 |
| small-talk | 4.4 s | 4.4 s | 7.4 s | 7.6 s | 6.7 |
| self | 4.9 s | 5.6 s | 12.5 s | 14.9 s | 5.8 |
| **overall** | 4.7 s | 9.4 s | 11.1 s | 17.0 s | 7.1 |

## Error analysis

- `named-beta-feedback` (named-note) — ignored named note: expected Beta feedback; read Localise into Norwegian, Lark log, 2026-09-29, 2026-09-28 — v0.9
- `named-ru-plan-platform` (named-note) — ignored named note: expected Lark plan; read Lark log; ungrounded claim: named “Lark plan” without having it
- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Bike maintenance manual
- `same-no-course` (same-language) — wrong note: expected Norskkurs; read Hytteturen
- `cross-en-ru-borscht` (cross-language) — retrieval miss: expected Борщ; read nothing

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 15 |
| wrong note | 4 |
| ignored named note | 2 |
| unneeded retrieval | 1 |
| missing items | 5 |
| decoy in context | 1 |
| ungrounded claim | 1 |

## Appendix: cases

### same-sourdough-ratio · same-language · PASS

**Question:** What's the feeding ratio for my sourdough starter?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.50)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 4.50)

**Answer:**

> Your current routine uses a **1:5:5** ratio (10 g starter : 50 g flour : 50 g water) fed once daily, using half rye and half white bread flour. This was adopted in September 2026 because your previous twice-daily **1:1:1** feeding resulted in a starter that peaked too quickly and became overly sour (Recipes/Sourdough starter.md).

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 12.3 s, total 25.0 s, search 0.0 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · PASS

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Your target race is the Oslo Half Marathon on 8 November 2026, with a goal of finishing under 1:50 (from *Running plan*). What specific pace per kilometer does that split require?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 5.4 s, total 11.8 s, search 0.0 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-chain-wear · same-language · PASS

**Question:** What's the wear limit for my 11-speed chain?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Chain (`Long/Bike maintenance manual.md`, score 5.83)

**Answer:**

> The wear limit is **0.5% elongation**. This comes from *Long/Bike maintenance manual.md › Chain*. Measure it every 500 km with a chain checker to catch this before it damages your cassette or chainrings. Are you currently tracking the kilometres on that specific chain?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 8.1 s, total 17.0 s, search 0.0 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-emergency-fund · same-language · PASS

**Question:** Сколько мне нужно накопить на подушку безопасности?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Подушка безопасности › Подушка безопасности (`Финансы/Подушка безопасности.md`, score 6.00)

**Answer:**

> Вам нужно накопить **540 000 рублей** (расход около 90 000/мес × 6 месяцев). Сейчас у вас есть 310 000. Хотите ли вы узнать, сколько осталось до цели?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 5.4 s, total 13.7 s, search 0.0 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-sleep · same-language · FAIL

**Question:** Во сколько мне лучше ложиться спать?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В архиве нет записей о вашем идеальном времени отхода ко сну или ваших графиков сна. Хотите ли вы добавить заметку об этом в хранилище?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 9.9 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-no-course · same-language · FAIL

**Question:** Hvilke dager har jeg norskkurs?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Hytteturen › Hytteturen (`Norsk/Hytteturen.md`, score 2.83)

**Answer:**

> Jeg vet ikke om du har norskkurs registrert i hytteplanene for 13.–16. februar 2027; der står det kun at vi skal skismøre, lage ved og ha brettspill med Ola og Kari. Vil du huske å ta med noe annet enn taco fredag?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 5.4 s, total 15.8 s, search 0.0 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет заметок о вашем решении касательно уведомлений в Lark.

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.4 s, total 6.9 s, search 0.0 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-sourdough · cross-language · FAIL

**Question:** Какое соотношение при кормлении закваски я сейчас использую?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет записей о текущем соотношении кормления вашей закваски. Вы хотели бы уточнить, какое именно отношение вы имели в виду (например, количество воды к муке)?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 10.3 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-marathon · cross-language · FAIL

**Question:** Когда у меня полумарафон?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет информации о вашем полумарафоне. Вы когда-нибудь планировали его в заметках, но забыли указать дату?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 8.5 s, search 0.0 s, 7.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-borscht · cross-language · FAIL

**Question:** How long do I bake the beets for borscht?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The duration to bake beets is not specified in the notes; only that they are roasted or boiled before being added to a Russian-style beet soup called borscht (Note: "Borscht recipe steps" by [User]). Do you have other preparation details for your specific batch?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 12.3 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-kitchen · cross-language · FAIL

**Question:** Who is doing my kitchen renovation and what's the budget?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The current list does not contain information about who is renovating your kitchen or the associated budget. Do you have a separate note on that project we can review?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 8.7 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-monetisation · cross-language · FAIL

**Question:** How did I decide to make money with Lark?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no note about your decision-making process regarding making money with Lark. Do you have a specific folder or timestamp you intended to reference that might hold these details?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.2 s, total 8.9 s, search 0.0 s, 7.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · FAIL

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Localise into Norwegian › Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 4.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 3.53)
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.48)
- 2026-09-28 — v0.9: Widget crash fixed › 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 2.36)

**Answer:**

> Testers request "weekly goals," specifically preferring "three times a week" over daily tracking [[2026-09-28 — v0.9: Widget crash fixed]]. This was the most requested feature collected during beta testing [[2026-09-29]].

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — ignored named note

**Timings:** TTFT 7.8 s, total 16.3 s, search 0.0 s, 7.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · FAIL

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 2.44)

**Answer:**

> Согласно заметке `[[Lark plan]]`, первой платформой для разработки указан **Telegram**. Эта стратегия выбрана, чтобы быстро проверить спрос и получить обратную связь от аудитории. Вы не планировали начать с других мессенджеров раньше этого этапа?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — ignored named note, ungrounded claim

**Timings:** TTFT 5.0 s, total 12.9 s, search 0.0 s, 7.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 6.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.25)
- Bike maintenance manual › Cassette (`Long/Bike maintenance manual.md`, score 4.08)
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 4.08)

**Answer:**

> Before switching due to it being too sour and peaking in 3 hours, you fed the old starter twice a day at a **1:1:1** ratio (50 g starter, 50 g flour, 50 g water) using only white flour. This was from your notes on *Sourdough starter (old)*.
> 
> Does this high-activity routine remind you of why the new slow feed once daily at a 1:5:5 ratio works better now?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 13.2 s, total 27.7 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · PASS

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** —

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

> You aimed for four hours of deep work a day. This goal came from reading the book in the evening on 2026-09-18 (Daily/2026/09/W38/2026-09-18.md › Deep Work).

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.4 s, total 18.2 s, search 0.0 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 2.75)
- Bike maintenance manual › Pedals (`Long/Bike maintenance manual.md`, score 2.75)

**Answer:**

> I don't have any notes regarding your decisions on Lark notifications or their location in the vault yet. Did you perhaps save them under a different name like "App Settings" or within a specific project folder?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 11.1 s, total 17.0 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · PASS

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Тбилиси › Тбилиси (`Путешествия/Тбилиси.md`, score 1.50)

**Answer:**

> Ели хинкали в «Зодиаке», хачапури — в «Сакхачапуре №1» и вино — в баре «Вино Андеграунд». Где еще хотели заглянуть, если не исчерпали эти места?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 6.7 s, total 15.2 s, search 0.0 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-last-week · recent · FAIL

**Question:** What did I work on in Lark last week?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 2.39)

**Answer:**

> On September 15, you worked on Lark widgets all day (note: `2026-09-15`). Did those widgets involve the specific features or integrations you mentioned earlier this month?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 5.0 s, total 11.2 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-wednesday · recent · FAIL

**Question:** What did I do on Wednesday last week?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I cannot find any note recording what you did on that specific day. Do you have a different date or activity you are trying to recall?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.4 s, total 9.1 s, search 0.0 s, 6.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-ru-since-monday · recent · FAIL

**Question:** Что нового в Lark с понедельника?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В записях из хранилища нет информации о новых функциях или обновлениях приложения Lark, произошедших после прошлого понедельник. Есть ли у вас какие-то заметки об этом продукте во вкладке «Рабочие инструменты»?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.2 s, total 11.5 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-last-week · tasks · FAIL

**Question:** Which Lark tasks from last week are still open, and which are done?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no information about Lark tasks or their status; therefore I cannot list what is open or completed. Did you perhaps save those details in a different folder or under a specific date range?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 9.8 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-done · tasks · FAIL

**Question:** Which Lark tasks are done?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no information about which specific Lark tasks have been completed. Do you perhaps mean to ask about a different project or set of notes we've recorded here?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 4.9 s, total 9.6 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-ru-overdue · tasks · FAIL

**Question:** Какие задачи у меня просрочены?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет заметок о ваших задачах или сроках их выполнения, поэтому я не могу определить какие из них просрочены. Есть ли в вашем архиве список дел или планерка с дедлайнами?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 11.3 s, search 0.0 s, 7.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-real-ru-last-week · tasks · FAIL

**Question:** что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Линейные уравнения › Линейные уравнения (`Учёба/Khan Academy/Линейные уравнения.md`, score 2.83)

**Answer:**

> Вы оставили без решения задачи № 9 и задачу № 10 из упражнения по линейным уравнениям (не доделали задачи 9–12). Вернитесь к ним.

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, missing items, decoy in context

**Timings:** TTFT 5.3 s, total 11.1 s, search 0.0 s, 7.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-wednesday · tasks · FAIL

**Question:** What's still open from Wednesday?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no records regarding items or tasks left open from Wednesday. Do you have a specific note about that day we can review?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 4.9 s, total 8.8 s, search 0.0 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-en-finished-last-week · tasks · FAIL

**Question:** Which tasks did I finish last week?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> I found no notes about your finished tasks; please try again with more specific details or ask a different question.

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 4.3 s, total 7.1 s, search 0.0 s, 8.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-loose-export · tasks · PASS

**Question:** Что мне ещё осталось доделать по экспорту?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Экспорт › Экспорт (`Projects/Lark/Экспорт.md`, score 4.50)

**Answer:**

> До релиза от 20 октября нужно доработать экспорт в JSON: сейчас выгружаются только привычки без истории отметок (см. «Экспорт»). Также стоит проверить работу экспорта с часовыми поясами там же. Что мешает завершить эти задачи раньше даты?

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.9 s, total 13.5 s, search 0.0 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-what-did-i-do · recent · FAIL

**Question:** What did I do last week?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no records of your actions or events from last week. Did you perhaps mean to record a specific project update during that time?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 4.4 s, total 8.2 s, search 0.0 s, 7.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The provided notes contain no information about the capital of Australia; please check a general knowledge source as I only know what you have written here. Do you want to save this fact for next time?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 4.3 s, total 10.0 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · PASS

**Question:** What did I write about my trip to Japan?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain any notes regarding a trip to Japan. Did you perhaps save those details under a different name or date?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 4.5 s, total 8.3 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-ru-netflix · not-in-vault · PASS

**Question:** Что я решил про подписку на Netflix?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.83)

**Answer:**

> В записях о монетизации Lark сказано только что вы решили отказаться от подписок (в частности для трекера привычек), но нет информации об вашем решении относительно Netflix. Хотите вспомнить, почему именно трекер должен быть простым без подписки?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 5.7 s, total 14.2 s, search 0.0 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-hi · small-talk · PASS

**Question:** hi!

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Hello. I am Recto, keeper of this vault. What would you like to know from your notes?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.0 s, total 7.4 s, search 0.0 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-ru-thanks · small-talk · PASS

**Question:** Спасибо, очень помог!

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Рад помочь. Есть ли ещё что-то из ваших заметок о чем стоит вспомнить?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.4 s, total 7.6 s, search 0.0 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-nice · small-talk · PASS

**Question:** haha nice

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> That is a pleasant sentiment! Did you have something specific to discuss or add to our collection?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.4 s, total 7.3 s, search 0.0 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-model · self · FAIL

**Question:** What model are you?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- 2026-09-08 — v0.1: Project skeleton › 2026-09-08 — v0.1: Project skeleton (`Projects/Lark/Lark log/2026-09-08 — v0.1.md`, score 1.50)

**Answer:**

> I am Recto, the keeper of this vault. I know only your notes from files like `2026-09-08 — v0.1: Project skeleton`. Would you like to summarize what was done in that first project file instead?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct false, honest —, language ok — unneeded retrieval

**Timings:** TTFT 5.6 s, total 14.9 s, search 0.0 s, 5.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-ru-knowledge-year · self · PASS

**Question:** Из какого года твои знания?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет записей о конкретных годах или датах происхождения моих знаний. Вы хотели бы добавить заметку об этом времени в архив?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.9 s, total 10.5 s, search 0.0 s, 6.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-privacy · self · PASS

**Question:** Are my notes sent anywhere?

**Router:** —

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The current context shows "No notes in the vault," so there are no records indicating where your notes have been sent or stored. Did you perhaps save them to a different folder or device before they disappeared from here?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.7 s, total 12.5 s, search 0.0 s, 5.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
