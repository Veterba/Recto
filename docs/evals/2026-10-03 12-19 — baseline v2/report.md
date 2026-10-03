---
run_id: "2026-10-03 12-19 — baseline v2"
date: 2026-10-03T10:19:56.019Z
model: qwen3.5:9b
commit: 0bca99b (dirty)
report_version: 1
compared_to: "2026-10-03 10-38 — baseline"
---

# Recto Eval: baseline v2

## Summary

Compared to "2026-10-03 10-38 — baseline", what changed: the code (b02b0ea → 0bca99b, uncommitted changes), the cases, taskIndex off, looseTasks off, steps off. 16 of 38 cases pass (42%), recall@4 28%, time to first token 5.3 s at the median (p90 10.1 s), 6.0 tokens/s. Pass rate 45% → 42%, recall@4 29% → 28%, TTFT p50 3.2 s → 5.3 s. Biggest win: tasks (▲ +14 pt). No kind got worse.

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 14.6 tokens/s (a throttling Mac shows under 5)
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
- **ungrounded claims**: 3. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 5.3 s, p90 10.1 s — from the question to the first token, including the vault search.
- **total time** p50 13.7 s, p90 27.3 s — from the question to the last token.
- **tokens/sec**: 6.0. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.0 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.4 GB; swap used 6.1 GB before → 6.0 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 4/6 (67%) | 67% | — | — | 67% | 67% | — | 0 |
| cross-language | 6 | 0/6 (0%) | 0% | — | — | 0% | 0% | — | 0 |
| named-note | 4 | 2/4 (50%) | 50% | — | — | 50% | 50% | — | 3 |
| follow-up | 2 | 1/2 (50%) | 50% | — | — | 50% | 50% | — | 0 |
| recent | 4 | 0/4 (0%) | 0% | 0% | — | 0% | 0% | — | 0 |
| tasks | 7 | 1/7 (14%) | 14% | 20% | — | 14% | 14% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | — | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | — | — | 100% | — | 0 |
| self | 3 | 2/3 (67%) | — | — | — | — | 67% | — | 0 |
| **overall** | 38 | 16/38 (42%) | 28% | 17% | — | 28% | 37% | 100% | 3 |

## Compared to 2026-10-03 10-38 — baseline

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 4/6 (67%) (=) | 67% (=) | — | — | 67% | 67% (=) | — | 0 (was 0) |
| cross-language | 6 | 0/6 (0%) (=) | 0% (=) | — | — | 0% | 0% (=) | — | 0 (was 0) |
| named-note | 4 | 2/4 (50%) (=) | 50% (=) | — | — | 50% | 50% (=) | — | 3 (was 0) |
| follow-up | 2 | 1/2 (50%) (=) | 50% (=) | — | — | 50% | 50% (=) | — | 0 (was 0) |
| recent | 4 | 0/4 (0%) (=) | 0% (=) | 0% | — | 0% | 0% (=) | — | 0 (was 0) |
| tasks | 7 | 1/7 (14%) ▲ +14 pt | 14% ▲ +14 pt | 20% | — | 14% | 14% ▲ +14 pt | — | 0 (was 0) |
| not-in-vault | 3 | 3/3 (100%) (=) | — | — | — | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | — | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 2/3 (67%) (=) | — | — | — | — | 67% (=) | — | 0 (was 0) |
| **overall** | 38 | 16/38 (42%) ▼ -3 pt | 28% ▼ -2 pt | 17% | — | 28% | 37% ▼ -3 pt | 100% | 3 (was 0) |

- pass → fail: none
- fail → pass: none
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 3.4 s | 10.1 s | 8.0 s | 48.3 s | 11.4 |
| cross-language | 4.1 s | 10.0 s | 9.9 s | 25.6 s | 6.4 |
| named-note | 7.7 s | 15.2 s | 21.9 s | 33.6 s | 5.0 |
| follow-up | 8.1 s | 14.0 s | 26.5 s | 27.3 s | 3.6 |
| recent | 5.2 s | 6.1 s | 13.8 s | 22.0 s | 3.9 |
| tasks | 5.3 s | 7.0 s | 14.2 s | 24.0 s | 3.9 |
| not-in-vault | 5.3 s | 7.2 s | 13.5 s | 27.5 s | 3.9 |
| small-talk | 5.4 s | 5.4 s | 10.3 s | 13.9 s | 4.9 |
| self | 3.7 s | 5.6 s | 8.2 s | 10.3 s | 8.0 |
| **overall** | 5.3 s | 10.1 s | 13.7 s | 27.3 s | 6.0 |

## Error analysis

- `named-beta-feedback` (named-note) — ignored named note: expected Beta feedback; read Localise into Norwegian, Lark log, 2026-09-29, 2026-09-28 — v0.9; ungrounded claim: named “Weekly goals” without having it
- `named-ru-plan-platform` (named-note) — ignored named note: expected Lark plan; read Lark log; ungrounded claim: named “Beta feedback”, “Lark plan” without having it
- `same-no-course` (same-language) — wrong note: expected Norskkurs; read Hytteturen
- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Bike maintenance manual
- `cross-ru-en-notifications` (cross-language) — retrieval miss: expected Lark plan; read nothing

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 15 |
| wrong note | 4 |
| ignored named note | 2 |
| unneeded retrieval | 1 |
| missing items | 5 |
| decoy in context | 1 |
| ungrounded claim | 2 |

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

> Your current routine uses a **1:5:5** ratio (10 g starter, 50 g flour, 50 g water) fed once daily at room temperature (*Recipes/Sourdough starter.md*). Before long trips, you switch to a **1:10:10** ratio and store it in the fridge.
> 
> Are you planning any travel soon that might require this change?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 10.1 s, total 15.8 s, search 0.0 s, 14.8 tokens/s

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

> Your goal is the Oslo half marathon on 8 November 2026 under 1:50 (Running plan). How does this target compare to your previous race results if you have any stored in other folders?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 3.3 s, total 6.4 s, search 0.0 s, 15.0 tokens/s

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

> The wear limit is **0.5% elongation**. You can find this in your *Bike maintenance manual* note on chains, which specifies that an 11-speed chain reaches its limit at this measurement before it starts damaging the cassette and chainrings. Have you measured yours yet?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.8 s, total 9.1 s, search 0.0 s, 14.1 tokens/s

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

> Вам нужно накопить **540 000 рублей** (6 месяцев расходов по ~90 000 руб.), но сейчас у вас есть только **310 000**. Вам не хватает еще примерно **230 000 рублей** для достижения цели.

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 3.4 s, total 8.0 s, search 0.0 s, 13.9 tokens/s

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

> В хранилище нет записей о вашем идеальном времени отхода ко сну или графике сна. Хотите ли вы добавить заметку об этом в свой архив?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.0 s, total 7.2 s, search 0.0 s, 9.3 tokens/s

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

> Jeg finner ingen informasjon om norskkurs i skuffen din; notene handler kun om en hyttetur til Hemsedal i februar 2027. Har du kanskje glemt å lagre disse datoene på et annet sted?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 5.6 s, total 48.3 s, search 0.0 s, 1.3 tokens/s

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

> Я не нашел заметок о вашем решении касательно уведомлений в Lark. Попробуйте уточнить детали или добавить эту информацию в хранилище, чтобы я мог найти ответ позже. Вы планировали изменить настройки уведомлений для какого-то конкретного проекта?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 10.0 s, total 25.6 s, search 0.0 s, 3.5 tokens/s

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

> В архиве нет записей о текущем соотношении воды и муки для вашей закваски или частоте её кормления. Возможно, вы ещё не фиксировали эти параметры в заметках. Вы планируете изменить график подкормок сегодня?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.6 s, total 14.8 s, search 0.0 s, 6.0 tokens/s

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

> В хранилище нет записей о дате вашего полумаратона. Вы, возможно, имели это в виду?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.3 s, total 8.6 s, search 0.0 s, 6.8 tokens/s

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

> The vault does not contain instructions on baking beets or making borscht. Do you have a note about your preferred cooking method written elsewhere?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.1 s, total 8.3 s, search 0.0 s, 7.2 tokens/s

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

> I found a note about your kitchen renovation being handled by "GreenLeaf Renovations" with a total budget of "$15,000." Want to know if you've noted any specific materials or dates for this project yet?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.0 s, total 10.6 s, search 0.0 s, 7.3 tokens/s

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

> There are no records in your vault detailing how you decided to monetize Lark or any specific plans related to making money with it. Would you like to try a different topic, perhaps one we have discussed before?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.9 s, total 9.9 s, search 0.0 s, 7.3 tokens/s

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

> Testers are asking most frequently for **weekly goals** (specifically "three times a week") rather than daily ones [[2026-09-28 — v0.9: Widget crash fixed]]. Additionally, there is strong interest in having strings localised into Norwegian based on tester requests [[Localise into Norwegian]] and feedback collected for Kari [[2026-09-29]].
> 
> Would you like to prioritise the weekly goals feature or start the Norwegian localisation next?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — ignored named note, ungrounded claim

**Timings:** TTFT 7.7 s, total 24.8 s, search 0.0 s, 6.2 tokens/s

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

> Согласно заметке **[[Lark log]]**, первым пунктом перечислена страница **[[Beta feedback]]** (отзывы бета-тестеров). Если вы имели в виду конкретный план действий внутри [[Lark plan]], пожалуйста, уточните детали.

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — ignored named note, ungrounded claim

**Timings:** TTFT 5.4 s, total 13.7 s, search 0.0 s, 7.1 tokens/s

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

> You used a 1:1:1 ratio of flour, water, and starter in your old routine; it was fed twice daily with only white flour until you switched because the dough peaked too quickly. Did this frequent feeding cause issues for you now that you've moved to once-a-day?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 15.2 s, total 33.6 s, search 0.0 s, 3.3 tokens/s

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

> You aimed for four hours of deep work a day. (Deep Work Reading/Deep Work.md). 
> 
> Did you try scheduling your blocks to hit that target recently?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 12.1 s, total 21.9 s, search 0.0 s, 3.5 tokens/s

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

> You didn't write anything down regarding Lark notifications; the vault contains only notes on bike maintenance (saddle height, bar tape replacement, cleat wear markers). Do you perhaps mean to discuss your cycling service schedule instead?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 14.0 s, total 26.5 s, search 0.0 s, 3.7 tokens/s

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

> Хинкали кушали в ресторане «Зодиак», а хачапури по-аджарски — в заведении «Сакхачапуре №1» (Путешествия/Тбилиси.md). В баре «Вино Андеграунд» пили вино.

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 8.1 s, total 27.3 s, search 0.0 s, 3.5 tokens/s

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

> You worked on **Lark widgets** throughout the entire period of September 15, 2026 (Week 38). The vault contains no notes about your activity for other days that previous week. Do you recall what specific tasks or iterations were involved in those widget sessions?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 6.1 s, total 22.0 s, search 0.0 s, 3.8 tokens/s

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

> I have found no records regarding your activities last Wednesday in the vault. Could you perhaps describe what day today is so we can look for that specific date again?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.2 s, total 13.8 s, search 0.0 s, 3.9 tokens/s

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

> В хранилище нет записей о новых функциях или обновлениях приложения Lark, появившихся после последнего понедельника. Вы писали ли что-то об этом в других заметках?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.6 s, total 15.5 s, search 0.0 s, 4.0 tokens/s

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

> The vault does not contain any information about your specific Lark tasks or their status for last week. Do you have a note where you tracked these items that I can look at instead?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.0 s, total 14.2 s, search 0.0 s, 4.1 tokens/s

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

> The vault contains no information about any completed Lark tasks. Do you have a specific project folder we should check instead?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 4.7 s, total 10.6 s, search 0.0 s, 4.2 tokens/s

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

> Вault не содержит информации о ваших задачах или их сроках. Можете ли вы добавить заметки с вашими делами в хранилище?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.3 s, total 13.4 s, search 0.0 s, 4.0 tokens/s

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

> Вы не доделали задачи **9–12** из упражнения на линейные уравнения (Учёба/Khan Academy). Возвращайтесь к ним. Хотите решить их сейчас?

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, missing items, decoy in context

**Timings:** TTFT 7.0 s, total 17.6 s, search 0.0 s, 3.9 tokens/s

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

> The vault contains no notes regarding tasks or items left open specifically on a "Wednesday." Would you like to specify which Wednesday or topic you are thinking of?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 5.3 s, total 13.9 s, search 0.0 s, 3.7 tokens/s

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

> I cannot answer that because there are no matching records about your completed tasks or timeline in the vault. Do you have a specific project name we should search for instead?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 5.3 s, total 14.3 s, search 0.0 s, 3.8 tokens/s

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

> Пока нужно закончить добавление историй отметок в JSON-экспорт (сейчас там только привычки) и убедиться, что работа с часовыми поясами корректна. До релиза от 20 октября. Есть ли у вас особые требования к формату часовых поясов?

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 6.6 s, total 24.0 s, search 0.0 s, 3.7 tokens/s

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

> The vault contains no records of your activities from last week. Do you have a specific topic or date range we should summarize instead?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 5.3 s, total 12.3 s, search 0.0 s, 3.8 tokens/s

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

> The vault contains no information regarding the capital of Australia or any other country facts outside your stored notes. Would you like to record a fact for future reference?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 5.3 s, total 13.5 s, search 0.0 s, 3.9 tokens/s

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

> I found no notes regarding a trip to Japan in your vault. Did you perhaps record those memories under a different heading or date range?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 4.8 s, total 11.7 s, search 0.0 s, 4.1 tokens/s

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

> Я не нашёл информации о вашем решении относительно подписки на Netflix в записях этого хранилища. Возможно, вы имели в виду решение по подписке для Lark (трекеру привычек), где вы решили отказаться от неё: «Думал про подписку, но решил: никаких подписок и рекламы» и «Основное бесплатно».

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 7.2 s, total 27.5 s, search 0.0 s, 3.7 tokens/s

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

> Hello. I am Recto, keeper of this vault. Ask me about your notes or a specific topic to begin. What would you like to explore today?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 5.4 s, total 13.9 s, search 0.0 s, 3.8 tokens/s

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

> Рада быть полезной. Есть ли что-то конкретное из ваших заметок, которое вы хотели бы пересмотреть?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 5.4 s, total 10.3 s, search 0.0 s, 5.7 tokens/s

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

> That's great to hear! Is there anything specific you'd like to explore or discuss based on your previous notes?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.6 s, total 9.2 s, search 0.0 s, 5.3 tokens/s

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

> I am Recto, your vault keeper who knows only what is written in these notes. Do you want to know about my current Xcode project or the Habit model I defined instead?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct false, honest —, language ok — unneeded retrieval

**Timings:** TTFT 5.6 s, total 10.3 s, search 0.0 s, 8.1 tokens/s

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

> В хранилище нет информации о том, из каких именно лет составлены записи. Могу ли я помочь с темой, по которой у нас есть заметки?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.6 s, total 8.2 s, search 0.0 s, 7.9 tokens/s

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

> The provided context does not contain information about whether your notes are sent anywhere. Did you write anything specific regarding data storage or sharing locations in your notes?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.7 s, total 7.6 s, search 0.0 s, 8.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
