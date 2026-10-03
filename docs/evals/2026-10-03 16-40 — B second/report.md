---
run_id: "2026-10-03 16-40 — B second"
date: 2026-10-03T14:40:32.643Z
model: qwen3.5:9b
commit: e314161 (dirty)
report_version: 1
compared_to: "2026-10-03 15-31 — B first- hybrid, names, classifier, scope tools"
---

# Recto Eval: B second

## Summary

Compared to "2026-10-03 15-31 — B first- hybrid, names, classifier, scope tools", what changed: nothing in the setup (same model, code, prompt and cases) - differences are the model’s own variation. 35 of 38 cases pass (92%), recall@4 89%, time to first token 16.5 s at the median (p90 29.1 s), 7.8 tokens/s. Pass rate 89% → 92%, recall@4 85% → 89%, TTFT p50 4.5 s → 16.5 s. Biggest win: tasks (▲ +29 pt). Biggest regression: not-in-vault (▼ -33 pt).

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 12.1 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"qwen3.5","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router on, classifier on, taskIndex on, looseTasks on, hybridRetrieval on, namedNotes on, scopeTools on, noteCards on, tools off, stickyContext on, steps on
- SYSTEM.md: sha256 `fc475e8d2362` (full text in config.json)
- Vault: fixture vault, 64 notes (ru 25, en 36, no 3); today = 2026-09-30
- Built before the run: chunk vectors for 64 notes (91 pieces embedded) in 8.0 s; note cards 64/64 in 0.0 s (cached cards reused)
- Cases: tests/bots/eval/cases.yaml (sha256 `464a72f230bf`)
- Machine: Apple M3, 16 GB RAM
- Code: feature/recto-rag-v1 @ e314161 with uncommitted changes, app 0.9.3

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

- **recall@4**: 89%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 45%. The answer names at least one expected note by title.
- **sources-correct**: 97%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 67%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 96%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 100%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self / review / advice); — before the router exists. Decided by rules 17, by the example questions 19, by the model 2.
- **ungrounded claims**: 0. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Judged on the model's own words, not on a list the harness wrote; a quoted phrase that is also in the notes it was given is a quote, not a claim. Must be 0; each is listed under Error analysis.
- **model tool calls**: 0, and 0 written as text instead of called (parse failures).
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 16.5 s, p90 29.1 s — from the question to the first token, including the vault search.
- **total time** p50 28.6 s, p90 47.1 s — from the question to the last token.
- **tokens/sec**: 7.8. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.4 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.8 GB; swap used 5.7 GB before → 6.6 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) | 100% | — | 100% | 67% | 100% | — | 0 |
| cross-language | 6 | 5/6 (83%) | 83% | — | 100% | 33% | 100% | — | 0 |
| named-note | 4 | 4/4 (100%) | 100% | — | 100% | 75% | 100% | — | 0 |
| follow-up | 2 | 1/2 (50%) | 50% | — | 100% | 0% | 50% | — | 0 |
| recent | 4 | 4/4 (100%) | 94% | 75% | 100% | 0% | 100% | — | 0 |
| tasks | 7 | 7/7 (100%) | 87% | 100% | 100% | 57% | 100% | — | 0 |
| not-in-vault | 3 | 2/3 (67%) | — | — | 100% | — | — | 67% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 35/38 (92%) | 89% | 96% | 100% | 45% | 97% | 67% | 0 |

## Compared to 2026-10-03 15-31 — B first- hybrid, names, classifier, scope tools

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) (=) | 100% (=) | — | 100% | 67% | 100% (=) | — | 0 (was 0) |
| cross-language | 6 | 5/6 (83%) (=) | 83% (=) | — | 100% | 33% | 100% (=) | — | 0 (was 0) |
| named-note | 4 | 4/4 (100%) (=) | 100% (=) | — | 100% | 75% | 100% (=) | — | 0 (was 0) |
| follow-up | 2 | 1/2 (50%) (=) | 50% (=) | — | 100% | 0% | 50% (=) | — | 0 (was 1) |
| recent | 4 | 4/4 (100%) (=) | 94% (=) | 75% ▼ -25 pt | 100% | 0% | 100% (=) | — | 0 (was 0) |
| tasks | 7 | 7/7 (100%) ▲ +29 pt | 87% ▲ +17 pt | 100% (=) | 100% | 57% | 100% ▲ +14 pt | — | 0 (was 0) |
| not-in-vault | 3 | 2/3 (67%) ▼ -33 pt | — | — | 100% | — | — | 67% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| **overall** | 38 | 35/38 (92%) ▲ +3 pt | 89% ▲ +4 pt | 96% ▼ -4 pt | 100% | 45% | 97% ▲ +3 pt | 67% | 0 (was 1) |

- pass → fail: `notin-australia`
- fail → pass: `tasks-open-last-week`, `tasks-real-ru-last-week`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 5.9 s | 11.7 s | 16.3 s | 20.8 s | 8.3 |
| cross-language | 22.0 s | 30.1 s | 31.3 s | 47.1 s | 8.8 |
| named-note | 22.9 s | 29.1 s | 30.8 s | 35.9 s | 8.9 |
| follow-up | 39.9 s | 53.3 s | 47.6 s | 67.0 s | 8.2 |
| recent | 17.3 s | 26.1 s | 33.1 s | 48.3 s | 7.7 |
| tasks | 0.0 s | 3.1 s | 25.6 s | 44.8 s | 8.1 |
| not-in-vault | 7.9 s | 9.5 s | 17.4 s | 18.1 s | 5.4 |
| small-talk | 22.3 s | 26.7 s | 25.7 s | 33.2 s | 6.3 |
| self | 23.6 s | 25.1 s | 31.5 s | 32.6 s | 7.0 |
| **overall** | 16.5 s | 29.1 s | 28.6 s | 47.1 s | 7.8 |

## Error analysis

- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read 2026-09-29, 2026-09-21, 2026-09-12 — v0.3, Bike maintenance manual; too slow: 67.0 s
- `cross-ru-en-notifications` (cross-language) — wrong note: expected Lark plan; read Идеи по монетизации, 2026-09-21, 2026-09-29, 2026-09-30
- `notin-australia` (not-in-vault) — hallucination: answered as if the notes had it

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| wrong note | 2 |
| hallucination | 1 |
| too slow | 1 |

## Appendix: cases

### same-sourdough-ratio · same-language · PASS

**Question:** What's the feeding ratio for my sourdough starter?

**Router:** **notes** by embedding · “What's the feeding ratio for my sourdough starter?” · classifier: notes 0.52 (margin 0.10) · en: feedi, ratio, sourdou, start · 0.6 s

**Steps:** Opened → Sourdough starter (old) · Opened → Sourdough starter · Searching notes → nothing

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.03)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 0.03)

**Answer:**

> Your current sourdough starter is fed once daily at a **1:5:5** ratio (10 g starter, 50 g flour, 50 g water). You also use half rye and half white bread flour. Before long trips, you switch to a 1:10:10 feed and store it in the fridge.
> 
> Would you like ideas on how this specific schedule affects your baking results?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 11.7 s, total 20.8 s, search 0.6 s, 9.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · PASS

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** **notes** by embedding · “When is my half marathon, and what time am I aiming for?” · classifier: notes 0.59 (margin 0.05) · en: half, marath, time, aiming · 0.1 s

**Steps:** Searching notes → “Running plan”

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 0.03)
- 2026-09-27 › 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 0.02)

**Answer:**

> Your goal is to run under 1:50 at the Oslo Half Marathon on November 8, 2026.
> 
> Would you like a plan for your upcoming Tuesday interval session to help build toward that target speed?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 6.7 s, total 12.1 s, search 0.1 s, 8.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-chain-wear · same-language · PASS

**Question:** What's the wear limit for my 11-speed chain?

**Router:** **notes** by embedding · “What's the wear limit for my 11-speed chain?” · classifier: notes 0.57 (margin 0.11) · en: wear, limit, speed, chain · 0.0 s

**Steps:** Searching notes → “Bike maintenance manual”

**Tool calls:** —

**Notes in context:**
- Bike maintenance manual › Bike maintenance manual > Chain (`Long/Bike maintenance manual.md`, score 0.03)
- Bike maintenance manual › Bike maintenance manual > Cassette (`Long/Bike maintenance manual.md`, score 0.03)

**Answer:**

> The wear limit for an 11-speed chain is 0.5% elongation. You should measure this every 500 km with a chain checker to ensure you replace it before damage occurs to your cassette and chainrings (from Bike maintenance manual > Chain).

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.5 s, total 16.3 s, search 0.1 s, 8.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-emergency-fund · same-language · PASS

**Question:** Сколько мне нужно накопить на подушку безопасности?

**Router:** **notes** by embedding · “Сколько мне нужно накопить на подушку безопасности?” · classifier: notes 0.55 (margin 0.02) · en: сколь, нужно, накопи, подуш, безопаснос · 0.0 s

**Steps:** Открыл → Подушка безопасности · Ищу в заметках → ничего

**Tool calls:** —

**Notes in context:**
- Подушка безопасности › Подушка безопасности (`Финансы/Подушка безопасности.md`, score 0.03)

**Answer:**

> Вам необходимо иметь **540 000 рублей**. Это рассчитано исходя из ваших месячных расходов (около 90 000 руб.) и целевого срока в 6 месяцев. На данный момент сбережены только 310 000, поэтому осталось накопить еще примерно 230 000 рублей.
> 
> Хотите ли вы обсудить способы ускорения достижения этой цели?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 19.8 s, search 0.0 s, 6.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-ru-sleep · same-language · PASS

**Question:** Во сколько мне лучше ложиться спать?

**Router:** **notes** by embedding · “Во сколько мне лучше ложиться спать?” · classifier: notes 0.58 (margin 0.00) · en: сколь, ложить, спать · 0.0 s

**Steps:** Ищу в заметках → “Сон”

**Tool calls:** —

**Notes in context:**
- Сон › Сон (`Здоровье/Сон.md`, score 0.02)

**Answer:**

> Согласно вашим записям в «Здоровье/Сон.md», оптимальное время отхода ко сну — до **23:30**. При соблюдении этого графика (вставать в 7:00, отказываться от экранов за час и держать температуру спальни на уровне 18 градусов) вы спите около 7,5 часов.
> 
> Нужно ли вам составить план действий для соблюдения этих правил завтра?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 5.2 s, total 19.1 s, search 0.1 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-no-course · same-language · PASS

**Question:** Hvilke dager har jeg norskkurs?

**Router:** **notes** by embedding · “Hvilke dager har jeg norskkurs?” · classifier: notes 0.59 (margin 0.02) · en: hvilke, dager, har, jeg, norskku · 0.0 s

**Steps:** Opened → Norskkurs · Searching notes → “Hytteturen”

**Tool calls:** —

**Notes in context:**
- Norskkurs › Norskkurs (`Norsk/Norskkurs.md`, score 0.03)
- Hytteturen › Hytteturen (`Norsk/Hytteturen.md`, score 0.03)

**Answer:**

> Du har norskkurs tirsdager og torsdager kl. 18.00–20.00, som står notert i *Norskkurs*. Lærer er Ingrid. Vil du ha tips på hvordan du kan øve muntlig mellom disse timene?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 13.0 s, search 0.1 s, 8.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** by embedding · “Что я решил про уведомления в Lark?” · classifier: notes 0.56 (margin 0.01) · en: решил, уведомлен, lark · 0.0 s

**Steps:** Ищу в заметках → “Идеи по монетизации”

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.03)
- 2026-09-21 › 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 0.02)
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 0.02)
- 2026-09-30 › 2026-09-30 (`Daily/2026/09/W40/2026-09-30.md`, score 0.02)
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.02)
- 2026-09-28 › 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 0.02)

**Answer:**

> В заметке «Идеи по монетизации (Проекты/Lark/Идеи по монетизации.md › Идеи по монетизации Lark)» указано, что для уведомлений установлены следующие правила:
> 
> *   Максимум два напоминания в день.
> *   Никаких сообщений о пропущенном streak («прерваной серии»). Только мягкие напоминания перед окончанием дня.
> *   Уведомления не приходят после 21:00 (тихий час с 21:00 до 08:00).
> 
> Вам нужно проверить, готовы ли вы к релизу в App Store на запланированную дату?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct true, honest —, language ok — wrong note

**Timings:** TTFT 30.1 s, total 47.1 s, search 0.1 s, 8.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-sourdough · cross-language · PASS

**Question:** Какое соотношение при кормлении закваски я сейчас использую?

**Router:** **notes** by embedding · “Какое соотношение при кормлении закваски я сейчас использую?” · classifier: notes 0.55 (margin 0.00) · en: какое, соотношен, кормлен, заквас, использ · 0.0 s

**Steps:** Ищу в заметках → “Sourdough starter”

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 0.02)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.02)
- Сырники › Сырники (`Рецепты/Сырники.md`, score 0.02)

**Answer:**

> Вы используете соотношение **1:5:5** (на 10 г закваски — по 50 г муки и воды). Это рутинный режим, действующий с сентября 2026 года. Для долгой поездки вы переключаетесь на усиленное кормление в пропорции **1:10:10** перед помещением её в холодильник.
> 
> Хотите ли вы попробовать эксперименты со старыми рецептами или скорректировать частоту кормления?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 22.0 s, total 34.3 s, search 0.1 s, 8.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-marathon · cross-language · PASS

**Question:** Когда у меня полумарафон?

**Router:** **notes** by embedding · “Когда у меня полумарафон?” · classifier: notes 0.58 (margin 0.01) · en: полумараф · 0.0 s

**Steps:** Ищу в заметках → “Running plan”

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 0.02)

**Answer:**

> Ваша цель — полумарафон в Осло 8 ноября 2026 года (из заметки *Running plan*). Это даст вам достаточно времени для тренировок до конца этого года и подготовки к следующему году. Хотите ли вы скорректировать текущий план с учётом праздников или других событий осенью?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 24.0 s, total 31.3 s, search 0.0 s, 9.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-borscht · cross-language · PASS

**Question:** How long do I bake the beets for borscht?

**Router:** **notes** by embedding · “How long do I bake the beets for borscht?” · classifier: notes 0.46 (margin 0.04) · en: long, bake, beets, borsc · 0.0 s

**Steps:** Searching notes → “Борщ”

**Tool calls:** —

**Notes in context:**
- Борщ › Борщ (`Рецепты/Борщ.md`, score 0.02)

**Answer:**

> For your 4-liter pot of borscht, you should bake the beets in foil at **200 °C for 40 minutes**. This method keeps them firm so they don't turn to mush when added later. Would you like me to remind you about adding vinegar and garlic only at the very end?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 15.7 s, total 23.2 s, search 0.1 s, 8.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-kitchen · cross-language · PASS

**Question:** Who is doing my kitchen renovation and what's the budget?

**Router:** **notes** by embedding · “Who is doing my kitchen renovation and what's the budget?” · classifier: notes 0.54 (margin 0.03) · en: doing, kitch, renovati, budget · 0.0 s

**Steps:** Opened → Budget 2026 · Searching notes → “Ремонт кухни”

**Tool calls:** —

**Notes in context:**
- Budget 2026 › Budget 2026 (`Finance/Budget 2026.md`, score 1.00)
- Ремонт кухни › Ремонт кухни (`Дом/Ремонт кухни.md`, score 0.02)

**Answer:**

> The contractor for your kitchen renovation is Igor (a team of three people), with a total budget of 450,000 rubles. Before starting on November 3rd, you need to choose tiles for the backsplash and order the sink. Would you like some tips on selecting quartz countertops or matte grey finishes?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 18.2 s, total 26.0 s, search 0.0 s, 8.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-en-ru-monetisation · cross-language · PASS

**Question:** How did I decide to make money with Lark?

**Router:** **notes** by embedding · “How did I decide to make money with Lark?” · classifier: notes 0.57 (margin 0.05) · en: decide, make, money, lark · 0.0 s

**Steps:** Searching notes → “Lark plan”

**Tool calls:** —

**Notes in context:**
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.03)
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 0.02)
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.02)
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 0.02)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 0.01)

**Answer:**

> You decided against subscriptions or ads because you believe a habit tracker should remain simple. Instead, your model is free for core features (habits, streaks) with one-time purchase of €12 to unlock themes and widget styles. You also considered adding voluntary "tips" later (€3, 5, or 10).
> 
> You wrote this in [[Идеи по монетизации]] and noted the reasoning: *subscription is annoying*.

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 26.1 s, total 37.2 s, search 0.0 s, 8.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · PASS

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **notes** by embedding · “Look in Beta feedback - what do testers ask for most?” · classifier: notes 0.60 (margin 0.02) · en: look, beta, feedba, teste, ask · 0.0 s

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

> In the **Beta feedback** note, 7 of the 12 TestFlight testers asked about "Weekly goals," making it far and away the most requested feature (specifically switching from daily to "three times a week"). Another common request was adding a way to pause habits while travelling.

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 29.1 s, total 35.9 s, search 0.1 s, 8.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · PASS

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **notes** by embedding · “Посмотри в Lark plan, какая платформа первая?” · classifier: notes 0.55 (margin 0.01) · en: lark, plan, платфор, первая · 0.0 s

**Steps:** Ищу в заметках → “Lark plan”

**Tool calls:** —

**Notes in context:**
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 0.02)
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 0.02)
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.02)

**Answer:**

> В планах указано **iOS** первой (приложение на SwiftUI). Разработка для Android запланирована только после версии 1.0 и достижения iOS-версией порога в 1 000 еженедельных пользователей [[Lark plan]].
> 
> Хотите обсудить, что именно должно быть реализовано к этому моменту?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 27.1 s, total 35.8 s, search 0.1 s, 8.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** by embedding · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · classifier: notes 0.53 (margin 0.04) · en: check, sourdou, start, old, ratio, before · 0.0 s

**Steps:** Opened → Sourdough starter (old) · Searching notes → “Sourdough starter”

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.03)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 0.03)
- Bike maintenance manual › Bike maintenance manual > Cassette (`Long/Bike maintenance manual.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Saddle and bars (`Long/Bike maintenance manual.md`, score 0.02)

**Answer:**

> You previously fed your sourdough twice daily at a **1:1:1** ratio (50 g starter, 50 g flour, 50 g water), using only white flour. This routine resulted in the starter being too sour and peaking in just 3 hours before you switched to your current method.

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 22.9 s, total 30.8 s, search 0.1 s, 8.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-deep-work · named-note · PASS

**Question:** In Deep Work, how many hours of deep work a day did I aim for?

**Router:** **notes** by embedding · “In Deep Work, how many hours of deep work a day did I aim for?” · classifier: notes 0.60 (margin 0.05) · en: deep, work, many, hours, day, aim · 0.0 s

**Steps:** Opened → Deep Work · Searching notes → “2026-09-18”

**Tool calls:** —

**Notes in context:**
- Deep Work › Deep Work (`Reading/Deep Work.md`, score 0.03)
- 2026-09-18 › 2026-09-18 (`Daily/2026/09/W38/2026-09-18.md`, score 0.04)
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 0.03)
- 2026-09-17 › 2026-09-17 (`Daily/2026/09/W38/2026-09-17.md`, score 0.02)
- 2026-09-12 — v0.3 › 2026-09-12 — v0.3: Notifications (`Projects/Lark/Lark log/2026-09-12 — v0.3.md`, score 0.02)
- 2026-09-16 › 2026-09-16 (`Daily/2026/09/W38/2026-09-16.md`, score 0.02)

**Answer:**

> You aimed for four hours of deep work a day. This goal comes from your takeaways in `Reading/Deep Work.md`.

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 21.0 s, total 23.7 s, search 0.1 s, 9.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** by model · “And where did I write that down?” · named: notifications · 22.0 s

**Steps:** Searching notes → “2026-09-29”

**Tool calls:** —

**Notes in context:**
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 0.02)
- 2026-09-21 › 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 0.02)
- 2026-09-12 — v0.3 › 2026-09-12 — v0.3: Notifications (`Projects/Lark/Lark log/2026-09-12 — v0.3.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Saddle and bars (`Long/Bike maintenance manual.md`, score 0.02)
- 2026-09-30 › 2026-09-30 (`Daily/2026/09/W40/2026-09-30.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Pedals (`Long/Bike maintenance manual.md`, score 0.02)

**Answer:**

> You wrote this decision on the note **Projects/Lark/Lark log/2026-09-12 — v0.3**, under the heading "Notifications". It outlines a scheduler allowing at most two reminders per day and setting quiet hours from 21:00 to 08:00, with logic to reschedule reminders if a habit is checked early so users aren't nagged about completed tasks.
> 
> Would you like to review how this rule interacts with your current task list for the App Store release?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note, too slow

**Timings:** TTFT 53.3 s, total 67.0 s, search 22.0 s, 8.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · PASS

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** by model · “А где мы там ели?” · en: eating place · ru: место еды · 24.7 s

**Steps:** Ищу в заметках → “Тбилиси”

**Tool calls:** —

**Notes in context:**
- Тбилиси › Тбилиси (`Путешествия/Тбилиси.md`, score 0.02)

**Answer:**

> - Хинкали — ресторан «Зодиак».  
> - Аджарский хачапури — кафе «Сакхачапуре №1».  
> - Вино пили в баре «Вино Андеграунд».  
> 
> Что ещё хотите вспомнить про еду или места?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 39.9 s, total 47.6 s, search 24.8 s, 8.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-last-week · recent · PASS

**Question:** What did I work on in Lark last week?

**Router:** **recent** by rules · “What did I work on in Lark last week?” · en: work, lark, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** Notes of the period → 13 notes

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

> Last week you shipped the **v0.6 Onboarding redesign** for Lark, replacing the five-screen tutorial with a single screen where users pick up to three habits (or type their own). This change reduced first-day drop-off from 40% to 18%. You also worked on:
> *   Adding dark mode and accessibility features (**v0.7**) like warm grey palettes, VoiceOver labels, and Dynamic Type support.
> *   Releasing the **TestFlight beta** with the initial crash reports noted.
> 
> You still have an open task to write the Lark privacy policy. Did you want to draft that now?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 26.1 s, total 42.2 s, search 0.0 s, 8.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-wednesday · recent · PASS

**Question:** What did I do on Wednesday last week?

**Router:** **recent** by rules · “What did I do on Wednesday last week?” · en: wednesd, last, week · period 2026-09-23..2026-09-23 · 0.0 s

**Steps:** Notes of the period → 2 notes

**Tool calls:** 
- `notes_in_period(2026-09-23, 2026-09-23)` by the harness → 2 notes: 2026-09-23, 2026-09-23 — v0.7: Dark mode and accessibility

**Notes in context:**
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 3.00)
- 2026-09-23 — v0.7: Dark mode and accessibility (`Projects/Lark/Lark log/2026-09-23 — v0.7.md`, score 2.90)

**Answer:**

> The vault contains notes for **Wednesday, September 23** (which appears to be in the future relative to your current date), covering tasks like writing a privacy policy and reviewing Maria's payments doc. It also details work on "Dark mode" and accessibility features such as VoiceOver labels. There is no record of activities from last week yet.
> 
> Would you like me to help plan what to do for next Wednesday?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 19.0 s, total 29.0 s, search 0.0 s, 8.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-ru-since-monday · recent · PASS

**Question:** Что нового в Lark с понедельника?

**Router:** **recent** by rules · “Что нового в Lark с понедельника?” · en: нового, lark, понедельни · period 2026-09-28..2026-09-30 · 0.0 s

**Steps:** Заметки за период → 6 notes

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

> С момента понедельника 30 сентября в проекте **Lark** (версия v0.9) произошло следующее:
> 
> 1.  Исправлен крах виджета на iOS 17.0 (добавлено фоллбэк-значение для отсутствующей иконки).
> 2.  Собран бета-обратная связь, где пользователи просят реализовать цель «три раза в неделю» вместо ежедневной отработки привычек.
> 
> Существуют незавершённые задачи по приватности (написание политики конфиденциальности), стоматологу и интернету для новой квартиры. Вы планируете выпуск релиза 20 октября?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 16.5 s, total 33.1 s, search 0.0 s, 8.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-last-week · tasks · PASS

**Question:** Which Lark tasks from last week are still open, and which are done?

**Router:** **tasks** by rules · “Which Lark tasks from last week are still open, and which are done?” · en: lark, tasks, last, week, still, open · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** Tasks → 9 open, 5 done

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
> From your notes on "Lark" (4), tasks like writing the privacy policy, localizing into Norwegian, and creating App Store screenshots remain to do or in progress. Meanwhile, adding VoiceOver labels and fixing a widget crash on iOS 17 were completed this period. Shall we prioritize any of these overdue items?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 67%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 19.1 s, search 0.0 s, 8.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-done · tasks · PASS

**Question:** Which Lark tasks are done?

**Router:** **tasks** by rules · “Which Lark tasks are done?” · en: lark, tasks · 0.0 s

**Steps:** Tasks → 12 open, 7 done, 2 from text

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
> The completed items listed in your vault are "VoiceOver labels" and "Fix widget crash on iOS 17". Shall we review the five remaining open tasks next?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 16.5 s, search 0.0 s, 9.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-ru-overdue · tasks · PASS

**Question:** Какие задачи у меня просрочены?

**Router:** **tasks** by rules · “Какие задачи у меня просрочены?” · en: какие, задачи, просроче · 0.0 s

**Steps:** Задачи → 12 open, 7 done, 2 from text

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: Write privacy policy

**Notes in context:**
- Write privacy policy (`tasks/Write privacy policy.md`, score 3.00)

**Answer:**

> Просрочено (1):
> • Write privacy policy (не начато, срок 26 сен - просрочено)
> 
> Срок по задаче «Write privacy policy» истёк (26 сен). Вы хотите, чтобы я помог составить черновик этой политики прямо сейчас?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 20.7 s, search 0.0 s, 8.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-real-ru-last-week · tasks · PASS

**Question:** что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику

**Router:** **tasks** by rules · “что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику” · en: додел, прошл, недели, задачи, одну, специфи · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** Задачи → 10 open in 6 groups

**Tool calls:** 
- `tasks_in_period(2026-09-21, 2026-09-27, open, topic)` by the harness → 10 open in 6 groups: 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, App Store screenshots, Localise into Norwegian, Write privacy policy

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 2.90)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.80)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.70)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.60)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.50)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.40)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.30)

**Answer:**

> Не доделано: 10 — по 6 темам.
> 
> **Lark**
> • Write privacy policy — Write privacy policy
> • Write Lark privacy policy — 21 сен
> • App Store screenshots — App Store screenshots
> • Localise into Norwegian — Localise into Norwegian
> 
> **Финансы**
> • Отправить отчёт по расходам — 24 сен
> • успеть с подарком к дню рождения Анны — 22 сен
> 
> **Дом**
> • Разобрать фото из Лиссабона — 22 сен
> 
> **Здоровье**
> • Записаться к стоматологу — 23 сен
> 
> **Health**
> • Try the new interval session — 23 сен
> 
> **Home**
> • Order fibre internet for the new flat — 25 сен
> 
> Сделано за этот период: 5.
> 
> Задачи по приватности Lark и локализации на норвежский остались без внимания; хотите ли перенести их на следующую неделю или найти время сегодня?

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 3.1 s, total 28.6 s, search 3.1 s, 8.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-wednesday · tasks · PASS

**Question:** What's still open from Wednesday?

**Router:** **tasks** by rules · “What's still open from Wednesday?” · en: still, open, wednesd · period 2026-09-23..2026-09-23 · 0.0 s

**Steps:** Tasks → 6 open in 4 groups

**Tool calls:** 
- `tasks_in_period(2026-09-23, 2026-09-23, open, topic)` by the harness → 6 open in 4 groups: 2026-09-23, App Store screenshots, Write privacy policy

**Notes in context:**
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 3.00)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.90)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.80)

**Answer:**

> Still open: 6 tasks in 4 groups.
> 
> **Lark**
> • Write privacy policy — Write privacy policy
> • App Store screenshots — App Store screenshots
> • Write Lark privacy policy — 23 Sep
> 
> **Дом**
> • Разобрать фото из Лиссабона — 23 Sep
> 
> **Здоровье**
> • Записаться к стоматологу — 23 Sep
> 
> **Health**
> • Try the new interval session — 23 Sep
> 
> Based on your notes, there are six tasks remaining across four groups: writing Lark's privacy policy and app store screenshots (Lark), sorting Lisbon photos (Дом), booking a dentist appointment (Здоровье), and trying the new interval session (Health). Did you want to prioritize any of these for today?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.6 s, total 44.8 s, search 0.6 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-en-finished-last-week · tasks · PASS

**Question:** Which tasks did I finish last week?

**Router:** **tasks** by rules · “Which tasks did I finish last week?” · en: tasks, finish, last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** Tasks → 9 open, 5 done

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
> Last week you completed reviewing Maria's payments doc (24 Sep), buying a gift for Anna (25 Sep), fixing the iOS 17 widget crash, and running your long distance of 16 km on 27 Sep. Shall we look at what needs to be done next?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 67%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 31.2 s, search 0.0 s, 7.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-loose-export · tasks · PASS

**Question:** Что мне ещё осталось доделать по экспорту?

**Router:** **tasks** by rules · “Что мне ещё осталось доделать по экспорту?” · en: ещё, остало, додела, экспор · 0.0 s

**Steps:** Задачи → 12 open, 7 done, 2 from text

**Tool calls:** 
- `tasks_in_period(2026-09-17, 2026-09-30)` by the harness → 12 open, 7 done, 2 from text: Экспорт

**Notes in context:**
- Экспорт (`Projects/Lark/Экспорт.md`, score 3.00)

**Answer:**

> Не доделано про «экспорту» (2):
> • Экспорт - надо доделать экспорт в JSON; проверить, как экспорт работает с часовыми поясами (без чекбокса)
> 
> По оставшимся пунктам нужно проверить работу экспорта с часовыми поясами без использования чекбокса и завершить вывод данных в формате JSON.

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 25.6 s, search 0.0 s, 6.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### recent-what-did-i-do · recent · PASS

**Question:** What did I do last week?

**Router:** **recent** by rules · “What did I do last week?” · en: last, week · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** Notes of the period → 13 notes

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

> Last week you shipped the **Onboarding redesign v0.6**, replacing a five-screen tutorial with a single screen that lets users pick up to three habits, which reduced first-day drop-offs from 40% to 18%. You also implemented **Dark mode** (warm greys with amber accents) and full **VoiceOver accessibility** support in version 0.7, then sent the **TestFlight beta v0.8** to 12 testers after buying a gift for Anna on her birthday.
> 
> Two crash reports appeared within a day regarding widgets crashing on iOS 17.0 if a habit has no icon, and you still have pending tasks like writing the Lark privacy policy and booking a dentist appointment. Shall we prioritize fixing that widget issue before the next build?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 17.3 s, total 48.3 s, search 0.0 s, 5.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · FAIL

**Question:** What's the capital of Australia?

**Router:** **notes** by embedding · “What's the capital of Australia?” · classifier: notes 0.45 (margin 0.02) · en: capit, austral · 2.8 s

**Steps:** Searching notes → nothing

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The capital of Australia is Canberra. My suggestions for connecting ideas: perhaps you could note down any other facts about Australian geography or history to build a reference section on it. Would that be useful?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest false, language ok — hallucination

**Timings:** TTFT 9.5 s, total 17.4 s, search 2.9 s, 5.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · PASS

**Question:** What did I write about my trip to Japan?

**Router:** **notes** by embedding · “What did I write about my trip to Japan?” · classifier: notes 0.76 (margin 0.12) · en: write, trip, japan · 0.1 s

**Steps:** Searching notes → nothing

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The vault contains no notes about a trip to Japan. Did you perhaps save your travel plans or reflections under a different title, such as "Travel" or a specific date?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 6.6 s, total 13.2 s, search 0.1 s, 5.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-ru-netflix · not-in-vault · PASS

**Question:** Что я решил про подписку на Netflix?

**Router:** **notes** by embedding · “Что я решил про подписку на Netflix?” · classifier: notes 0.56 (margin 0.02) · en: решил, подпис, netfl · 0.0 s

**Steps:** Ищу в заметках → “Идеи по монетизации”

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.03)

**Answer:**

> В предоставленных заметках из «Идеи по монетизации Lark» нет информации о вашем решении касательно подписки на Netflix. Возможно, вы обсуждали это в другой записи или имели в виду решение отменить/взять эту подписку для проекта?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 7.9 s, total 18.1 s, search 0.1 s, 5.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-hi · small-talk · PASS

**Question:** hi!

**Router:** **smalltalk** by rules · “hi!” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Hello! I am Recto, your vault keeper. Ready when you are—what would you like to explore or organize today?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 5.7 s, total 10.3 s, search 0.0 s, 5.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-ru-thanks · small-talk · PASS

**Question:** Спасибо, очень помог!

**Router:** **smalltalk** by rules · “Спасибо, очень помог!” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> Всегда рад помочь с вашими заметками. Чем я могу быть полезен дальше? Может быть, стоит пересмотреть какую-то тему или составить план по новым задачам?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 26.7 s, total 33.2 s, search 0.0 s, 5.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### talk-nice · small-talk · PASS

**Question:** haha nice

**Router:** **smalltalk** by rules · “haha nice” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> That is a nice response! Would you like me to review your vault, or perhaps summarize a specific topic within it?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 22.3 s, total 25.7 s, search 0.0 s, 7.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-model · self · PASS

**Question:** What model are you?

**Router:** **self** by rules · “What model are you?” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> My identity is Recto, the keeper of this vault. I work with your specific notes and tasks within that context rather than as a general-purpose AI model. How can I help organize or explore what you've written today?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 23.6 s, total 30.0 s, search 0.0 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-ru-knowledge-year · self · PASS

**Question:** Из какого года твои знания?

**Router:** **self** by rules · “Из какого года твои знания?” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> В моих записях нет конкретной даты, указывающей на год происхождения информации; они представляют собой набор заметок без встроенного хронологического контекста по умолчанию.
> 
> У тебя есть в архиве какие-то записи с датами событий или проектов из конкретного года?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 22.8 s, total 31.5 s, search 0.0 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### self-privacy · self · PASS

**Question:** Are my notes sent anywhere?

**Router:** **self** by rules · “Are my notes sent anywhere?” · 0.0 s

**Steps:** —

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> No, your notes are not sent anywhere else; they exist only within this vault context provided for our session. They remain private between us unless you explicitly share them with someone outside here. Do you have any specific security concerns about how we discuss these notes today?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 25.1 s, total 32.6 s, search 0.0 s, 7.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
