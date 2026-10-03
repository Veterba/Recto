---
run_id: "2026-10-03 12-38 — 3.2 router"
date: 2026-10-03T10:38:01.904Z
model: qwen3.5:9b
commit: 0bca99b (dirty)
report_version: 1
compared_to: "2026-10-03 12-28 — 3.1 speed"
---

# Recto Eval: 3.2 router

## Summary

Compared to "2026-10-03 12-28 — 3.1 speed", what changed: router on. 14 of 38 cases pass (37%), recall@4 31%, time to first token 9.3 s at the median (p90 16.5 s), 7.2 tokens/s. Pass rate 42% → 37%, recall@4 28% → 31%, TTFT p50 4.7 s → 9.3 s. Biggest win: self (▲ +33 pt). Biggest regression: follow-up (▼ -50 pt).

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 7.6 tokens/s (a throttling Mac shows under 5)
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

- **recall@4**: 31%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 24%. The answer names at least one expected note by title.
- **sources-correct**: 43%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 17%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 87%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self); — before the router exists.
- **ungrounded claims**: 1. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 9.3 s, p90 16.5 s — from the question to the first token, including the vault search.
- **total time** p50 13.5 s, p90 25.4 s — from the question to the last token.
- **tokens/sec**: 7.2. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.1 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.4 GB; swap used 6.4 GB before → 6.3 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 3/6 (50%) | 67% | — | 83% | 50% | 67% | — | 0 |
| cross-language | 6 | 0/6 (0%) | 17% | — | 83% | 17% | 17% | — | 0 |
| named-note | 4 | 2/4 (50%) | 50% | — | 50% | 50% | 50% | — | 1 |
| follow-up | 2 | 0/2 (0%) | 0% | — | 100% | 0% | 0% | — | 0 |
| recent | 4 | 0/4 (0%) | 0% | 0% | 100% | 0% | 0% | — | 0 |
| tasks | 7 | 1/7 (14%) | 29% | 20% | 100% | 14% | 29% | — | 0 |
| not-in-vault | 3 | 2/3 (67%) | — | — | 67% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 14/38 (37%) | 31% | 17% | 87% | 24% | 43% | 100% | 1 |

## Compared to 2026-10-03 12-28 — 3.1 speed

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 3/6 (50%) ▼ -17 pt | 67% (=) | — | 83% | 50% | 67% (=) | — | 0 (was 0) |
| cross-language | 6 | 0/6 (0%) (=) | 17% ▲ +17 pt | — | 83% | 17% | 17% ▲ +17 pt | — | 0 (was 0) |
| named-note | 4 | 2/4 (50%) (=) | 50% (=) | — | 50% | 50% | 50% (=) | — | 1 (was 1) |
| follow-up | 2 | 0/2 (0%) ▼ -50 pt | 0% ▼ -50 pt | — | 100% | 0% | 0% ▼ -50 pt | — | 0 (was 0) |
| recent | 4 | 0/4 (0%) (=) | 0% (=) | 0% (=) | 100% | 0% | 0% (=) | — | 0 (was 0) |
| tasks | 7 | 1/7 (14%) (=) | 29% ▲ +14 pt | 20% (=) | 100% | 14% | 29% ▲ +14 pt | — | 0 (was 0) |
| not-in-vault | 3 | 2/3 (67%) ▼ -33 pt | — | — | 67% | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 3/3 (100%) ▲ +33 pt | — | — | 100% | — | 100% ▲ +33 pt | — | 0 (was 0) |
| **overall** | 38 | 14/38 (37%) ▼ -5 pt | 31% ▲ +3 pt | 17% (=) | 87% | 24% | 43% ▲ +6 pt | 100% | 1 (was 1) |

- pass → fail: `same-half-marathon`, `follow-ru-tbilisi-food`, `notin-japan`
- fail → pass: `self-model`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 12.6 s | 19.1 s | 21.3 s | 32.6 s | 6.6 |
| cross-language | 11.4 s | 12.7 s | 16.3 s | 19.0 s | 7.3 |
| named-note | 14.5 s | 20.7 s | 25.4 s | 31.0 s | 6.7 |
| follow-up | 13.1 s | 16.5 s | 21.1 s | 24.6 s | 6.2 |
| recent | 2.6 s | 3.3 s | 10.1 s | 11.3 s | 7.4 |
| tasks | 2.0 s | 3.4 s | 8.6 s | 12.2 s | 7.6 |
| not-in-vault | 9.3 s | 12.1 s | 13.5 s | 20.3 s | 6.7 |
| small-talk | 1.6 s | 1.8 s | 6.1 s | 7.5 s | 8.0 |
| self | 1.8 s | 1.8 s | 7.8 s | 8.0 s | 7.6 |
| **overall** | 9.3 s | 16.5 s | 13.5 s | 25.4 s | 7.2 |

## Error analysis

- `named-beta-feedback` (named-note) — ignored named note: expected Beta feedback; read Localise into Norwegian, Lark log, 2026-09-29, 2026-09-28 — v0.9; wrong route: router said tasks
- `named-ru-plan-platform` (named-note) — ignored named note: expected Lark plan; read Lark log; ungrounded claim: named “(projects/lark/ .md ›  )” without having it; wrong route: router said tasks
- `follow-ru-tbilisi-food` (follow-up) — retrieval miss: expected Тбилиси; read nothing
- `same-no-course` (same-language) — wrong note: expected Norskkurs; read Hytteturen
- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Bike maintenance manual

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 12 |
| wrong note | 6 |
| ignored named note | 2 |
| missing items | 5 |
| decoy in context | 1 |
| ungrounded claim | 1 |
| wrong route | 5 |

## Appendix: cases

### same-sourdough-ratio · same-language · PASS

**Question:** What's the feeding ratio for my sourdough starter?

**Router:** **notes** · “What's the feeding ratio for my sourdough starter?” · named: sourdough starter · 12.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.50)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 4.50)

**Answer:**

> Your current routine uses a **1:5:5** ratio (10 g starter : 50 g flour : 50 g water) fed once a day, according to *Recipes/Sourdough starter.md*. If you are preparing for a long trip before the next feeding, you feed at a **1:10:10** ratio and refrigerate it.
> 
> Are there any specific conditions in your current routine that need adjusting?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 19.1 s, total 32.6 s, search 12.3 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · FAIL

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** **tasks** · “When is my half marathon, and what time am I aiming for?” · named: half marathon · 7.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Your goal is the Oslo Half Marathon on November 8, 2026, with a target time under 1:50 (from *Running plan*). Did you want to know how your current long run schedule compares to that deadline?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok — wrong route

**Timings:** TTFT 12.6 s, total 20.1 s, search 7.2 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-chain-wear · same-language · PASS

**Question:** What's the wear limit for my 11-speed chain?

**Router:** **notes** · “What's the wear limit for my 11-speed chain?” · named: wear limit · 7.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Chain (`Long/Bike maintenance manual.md`, score 5.83)

**Answer:**

> The wear limit is **0.5% elongation** (measured every 500 km). This comes from `Long/Bike maintenance manual.md › Chain`. Would you like to know when this part should be replaced instead of just checked?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 14.8 s, total 22.9 s, search 7.2 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-emergency-fund · same-language · PASS

**Question:** Сколько мне нужно накопить на подушку безопасности?

**Router:** **notes** · “Сколько мне нужно накопить на подушку безопасности?” · ru: подушка безопасности · 7.9 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Подушка безопасности › Подушка безопасности (`Финансы/Подушка безопасности.md`, score 6.00)

**Answer:**

> Вам нужно накопить **540 000 рублей** (расходы ~90 000 руб/мес × 6 месяцев). Сейчас у вас уже есть 310 000 рублей. Хотите ли вы узнать, сколько времени потребуется для достижения этой цели при текущем темпе сбережений?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 13.0 s, total 24.1 s, search 7.9 s, 6.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-sleep · same-language · FAIL

**Question:** Во сколько мне лучше ложиться спать?

**Router:** **notes** · “Во сколько мне лучше ложиться спать?” · ru: сон · 7.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В хранилище нет записей о том, когда вам стоит ложиться спать или какие у вас есть предпочтения относительно сна. Хотите ли вы добавить заметку об этом в архив для будущих ссылок?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 11.3 s, total 18.3 s, search 7.3 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-no-course · same-language · FAIL

**Question:** Hvilke dager har jeg norskkurs?

**Router:** **notes** · “Hvilke dager har jeg norskkurs?” · named: norskkurs · 7.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Hytteturen › Hytteturen (`Norsk/Hytteturen.md`, score 2.83)

**Answer:**

> Jeg fant ingen notater om norskurser i hytteboka for Hytteturen 13.–16. februar 2027, bare at vi skal med skismøring og ved til peisen. Må jeg sjekke andre mapper?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 12.4 s, total 21.3 s, search 7.4 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** · “Что я решил про уведомления в Lark?” · ru: уведомления, Lark · 8.8 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В папке нет заметок о ваших решениях по поводу уведомлений в Lark. Если вы записали это позже, пожалуйста, добавьте эту информацию в контекст, и я смогу вас об этом напомнить.

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 12.7 s, total 19.0 s, search 8.8 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-sourdough · cross-language · FAIL

**Question:** Какое соотношение при кормлении закваски я сейчас использую?

**Router:** **notes** · “Какое соотношение при кормлении закваски я сейчас использую?” · ru: закваска · 8.6 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В вальте нет записей о вашем текущем соотношении кормления закваски. Вы хотели бы отметить это значение, чтобы потом не забыть детали процесса?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 12.7 s, total 17.4 s, search 8.6 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-marathon · cross-language · FAIL

**Question:** Когда у меня полумарафон?

**Router:** **tasks** · “Когда у меня полумарафон?” · en: half marathon · 6.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 2.83)

**Answer:**

> Ваша цель — полумарафон в Осло **8 ноября 2026 года**. Это указано в заметке "Running plan". Вы хотите скорректировать тренировочный график перед этой датой?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok — wrong route

**Timings:** TTFT 11.4 s, total 17.9 s, search 6.5 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-borscht · cross-language · FAIL

**Question:** How long do I bake the beets for borscht?

**Router:** **notes** · “How long do I bake the beets for borscht?” · named: baking time for beets · 7.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain information on beet baking times or borscht recipes. Do you have a note about preparing ingredients elsewhere that we can reference instead?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 11.3 s, total 15.6 s, search 7.4 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-kitchen · cross-language · FAIL

**Question:** Who is doing my kitchen renovation and what's the budget?

**Router:** **notes** · “Who is doing my kitchen renovation and what's the budget?” · named: kitchen renovation · 6.9 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> There are no notes about your kitchen renovation or its budget in the vault yet. Did you already write down a contractor name while planning?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 10.9 s, total 14.7 s, search 6.9 s, 7.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-monetisation · cross-language · FAIL

**Question:** How did I decide to make money with Lark?

**Router:** **notes** · “How did I decide to make money with Lark?” · named: How did I decide to make money with Lark · 8.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no records of your decision-making process regarding monetization with Lark. Did you perhaps document that idea under a different project or date recently?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 11.9 s, total 16.3 s, search 8.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · FAIL

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **tasks** · “Look in Beta feedback - what do testers ask for most?” · en: Beta feedback · 7.1 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Localise into Norwegian › Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 4.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 3.53)
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 2.48)
- 2026-09-28 — v0.9: Widget crash fixed › 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 2.36)

**Answer:**

> The most requested feature by beta testers is "weekly goals," specifically preferring to track activity "three times a week" rather than every day [[2026-09-28 — v0.9: Widget crash fixed]]. Testers also want localization into Norwegian, as noted in the feedback collected on September 29th [[Localise into Norwegian]] and [[2026-09-29]].
> 
> Would you like to prioritize implementing these weekly goals or start localizing strings for Norway?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — ignored named note, wrong route

**Timings:** TTFT 14.5 s, total 31.0 s, search 7.1 s, 6.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · FAIL

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **tasks** · “Посмотри в Lark plan, какая платформа первая?” · en: Lark · 7.2 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 2.44)

**Answer:**

> Первой платформой для проекта Lark указана **Lark**. Связано с заметкой `[[Lark log (Projects/Lark/Lark log.md › Lark log)]]`. Это логика выбора названия и структуры. Есть ли у тебя вопросы по этапу разработки этой платформы?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — ignored named note, ungrounded claim, wrong route

**Timings:** TTFT 11.9 s, total 21.0 s, search 7.2 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · named: Sourdough starter · 7.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 6.00)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 5.25)
- Bike maintenance manual › Cassette (`Long/Bike maintenance manual.md`, score 4.08)
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 4.08)

**Answer:**

> You used a **1:1:1** ratio (50 g starter, 50 g flour, 50 g water), feeding twice daily. This note explains that the routine was abandoned because the starter always became too sour and peaked in only three hours [[Sourdough starter (old)]].

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 20.7 s, total 29.9 s, search 7.3 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · PASS

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** **notes** · “In Deep Work, how many hours of deep work a day did I aim for?” · named: Deep Work · 7.1 s

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

> You aimed for four hours of deep work per day. This comes from the *Deep Work* note where you recorded your takeaways on Cal Newport's book. Did this target align with your actual working capacity when you read it on 2026-09-18?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.7 s, total 25.4 s, search 7.1 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** · “And where did I write that down?” · named: notifications · 7.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 2.75)
- Bike maintenance manual › Pedals (`Long/Bike maintenance manual.md`, score 2.75)

**Answer:**

> No note found regarding your decisions on Lark notifications in the vault. Did you perhaps mean to record this for me instead of deciding it now?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 16.5 s, total 21.1 s, search 7.5 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · FAIL

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** · “А где мы там ели?” · ru: Тбилиси · 10.3 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Вы обедали и ужинали преимущественно на улице: в кафе под открытым небом у реки Мтцхета, а также заказывали еду из доставки прямо к хостелу «Фабрика». Вы не записали названия конкретных ресторанов. Где именно вы хотели бы узнать больше о еде?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 13.1 s, total 24.6 s, search 10.3 s, 6.0 tokens/s

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
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 2.39)

**Answer:**

> You worked on Lark widgets, specifically noted as working on them "all day" on September 15th (2026-09-15). Do you remember if this task continued into the days before or after that date?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 2.7 s, total 10.1 s, search 0.0 s, 7.0 tokens/s

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

> On Wednesday, September 23rd (last week), you focused on Dark mode and VoiceOver, with a one-on-one meeting scheduled for tomorrow according to `2026-09-23`. Was there anything else related to accessibility or interface design that came up?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 3.3 s, total 11.3 s, search 0.0 s, 7.4 tokens/s

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

> В понедельник (2026-09-14) никаких изменений или новостей о Lark не зафиксировано; единственный упомянутый инцидент — блокировка банковской карты после поездки. Есть ли у вас заметки, где вы писали про обновления в Lark позже?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 2.6 s, total 10.9 s, search 0.0 s, 7.6 tokens/s

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
- none

**Answer:**

> The vault does not contain information about your specific Lark tasks or their status for last week. Do you have a note stored regarding that work period we can review instead?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 2.0 s, total 6.5 s, search 0.0 s, 7.8 tokens/s

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

> The vault does not contain information about which specific Lark tasks have been completed; please check your external task list or ask a different question based on available records. Would you like to explore what topics *are* documented in this vault instead?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 1.8 s, total 8.2 s, search 0.0 s, 7.7 tokens/s

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

> В хранилище нет записей о ваших задачах или сроках их выполнения, поэтому я не могу сообщить, что является просроченным. Вы хотели бы добавить заметку об этом в папку «Задачи»?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 1.9 s, total 8.6 s, search 0.0 s, 7.4 tokens/s

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

> Вы не доделали задачи № 9–12 из упражнения по линейным уравнениям (раздел «Задачи на составление уравнений»). Об этом сказано в заметке «Линейные уравнения» от раздела алгебры Khan Academy. Хотите ли вы вернуться к этим конкретным задачам?

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, missing items, decoy in context

**Timings:** TTFT 3.4 s, total 12.2 s, search 0.0 s, 7.7 tokens/s

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

> Nothing is noted as "open" for Wednesday; your notes only record a meeting with Maria on Tuesday and planning an App Store release on October 1st (see `2026-09-30`). Did you intend to ask about the previous Wednesday or something else?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok — missing items

**Timings:** TTFT 3.2 s, total 10.9 s, search 0.0 s, 7.7 tokens/s

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

> There are no records in my vault regarding which tasks you finished last week. Did you perhaps note them under a different date or title?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 1.9 s, total 5.5 s, search 0.0 s, 7.8 tokens/s

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

> Остается доделать экспорт в JSON (сейчас выгружаются только привычки без истории), а также проверка работы экспорта с учетом разных часовых поясов. Это нужно сделать до релиза 20 октября (Проект/Lark/Экспорт.md).

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 2.5 s, total 10.5 s, search 0.0 s, 7.1 tokens/s

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

> I have not recorded any activities or events you performed last week. Would you like to add a note about what happened so it can be saved for later reference?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss, missing items

**Timings:** TTFT 1.9 s, total 6.3 s, search 0.0 s, 7.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** **notes** · “What's the capital of Australia?” · named: What's the capital of Australia? · 7.4 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain information about the capitals of countries or Australian geography. Would you like to record a note on your travels instead?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 9.3 s, total 13.5 s, search 7.4 s, 6.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · FAIL

**Question:** What did I write about my trip to Japan?

**Router:** **recent** · “What did I write about my trip to Japan?” · en: write, trip, japan · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault does not contain any notes about a trip to Japan. Did you perhaps save those details under a different date or topic name?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok — wrong route

**Timings:** TTFT 2.0 s, total 6.4 s, search 0.0 s, 6.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-ru-netflix · not-in-vault · PASS

**Question:** Что я решил про подписку на Netflix?

**Router:** **notes** · “Что я решил про подписку на Netflix?” · ru: Netflix · 8.5 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации Lark › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 2.83)

**Answer:**

> В записях о монетизации Lark указано только ваше решение отказаться от подписок (включая рекламу) для этого проекта. Информация о вашем решении относительно подписки на Netflix в данной секции не содержится. Вы хотели бы добавить эту мысль в заметку по идеям?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 12.1 s, total 20.3 s, search 8.5 s, 7.1 tokens/s

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

> Hello. I am Recto, your keeper here in this vault. What shall we look at first? Do you have a specific note or folder you wish to open?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.6 s, total 6.1 s, search 0.0 s, 7.7 tokens/s

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

> Ваша благодарность не зафиксирована в архиве этой комнаты; здесь хранятся только ваши заметки и факты. Есть ли среди ваших файлов что-то, что нужно проверить или связать?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.8 s, total 7.5 s, search 0.0 s, 7.8 tokens/s

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

> The vault contains no note from "haha nice." Would you like to save this reaction as a new entry?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.6 s, total 4.4 s, search 0.0 s, 8.3 tokens/s

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

> I am Recto, the keeper of this vault; my knowledge is strictly limited to your stored notes rather than the world or external training data. Did a specific note about models exist in our collection that you'd like me to retrieve instead?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.6 s, total 8.0 s, search 0.0 s, 7.7 tokens/s

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

> В хранилище нет записей о датах создания или времени сбора данных; оно содержит только ваши заметки и контекст из них. Вы когда-нибудь отмечали, с какого периода начинают вести свои записи?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.8 s, total 7.8 s, search 0.0 s, 7.7 tokens/s

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

> The vault is secure and local; your notes are not sent outside this session unless explicitly instructed by a system command or plugin integration you have enabled. Do you need to know which plugins might transfer data in specific workflows?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 1.8 s, total 7.8 s, search 0.0 s, 7.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
