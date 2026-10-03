---
run_id: "2026-10-03 18-38 — B final"
date: 2026-10-03T16:38:09.176Z
model: qwen3.5:9b
commit: e314161 (dirty)
report_version: 1
compared_to: "2026-10-03 18-24 — B tools on"
---

# Recto Eval: B final

## Summary

Compared to "2026-10-03 18-24 — B tools on", what changed: tools off. 38 of 38 cases pass (100%), recall@4 96%, time to first token 6.8 s at the median (p90 17.5 s), 7.0 tokens/s. Pass rate 97% → 100%, recall@4 96% → 96%, TTFT p50 8.6 s → 6.8 s. Biggest win: named-note (▲ +25 pt). No kind got worse.

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 7.3 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"qwen3.5","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router on, classifier on, taskIndex on, looseTasks on, hybridRetrieval on, namedNotes on, scopeTools on, noteCards on, tools off, stickyContext on, steps on
- SYSTEM.md: sha256 `fc475e8d2362` (full text in config.json)
- Vault: fixture vault, 64 notes (ru 25, en 36, no 3); today = 2026-09-30
- Built before the run: chunk vectors for 64 notes (91 pieces embedded) in 9.2 s; note cards 64/64 in 0.0 s (cached cards reused)
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

- **recall@4**: 96%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 45%. The answer names at least one expected note by title.
- **sources-correct**: 100%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 100%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 100%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self / review / advice); — before the router exists. Decided by rules 17, by the example questions 19, by the model 2.
- **ungrounded claims**: 0. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Judged on the model's own words, not on a list the harness wrote; a quoted phrase that is also in the notes it was given is a quote, not a claim. Must be 0; each is listed under Error analysis.
- **model tool calls**: 0, and 0 written as text instead of called (parse failures).
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 6.8 s, p90 17.5 s — from the question to the first token, including the vault search.
- **total time** p50 15.9 s, p90 38.0 s — from the question to the last token.
- **tokens/sec**: 7.0. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.2 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.7 GB; swap used 5.0 GB before → 5.1 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) | 100% | — | 100% | 17% | 100% | — | 0 |
| cross-language | 6 | 6/6 (100%) | 100% | — | 100% | 67% | 100% | — | 0 |
| named-note | 4 | 4/4 (100%) | 100% | — | 100% | 75% | 100% | — | 0 |
| follow-up | 2 | 2/2 (100%) | 100% | — | 100% | 50% | 100% | — | 0 |
| recent | 4 | 4/4 (100%) | 94% | 100% | 100% | 0% | 100% | — | 0 |
| tasks | 7 | 7/7 (100%) | 87% | 100% | 100% | 57% | 100% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | 100% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 38/38 (100%) | 96% | 100% | 100% | 45% | 100% | 100% | 0 |

## Compared to 2026-10-03 18-24 — B tools on

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) (=) | 100% (=) | — | 100% | 17% | 100% (=) | — | 0 (was 0) |
| cross-language | 6 | 6/6 (100%) (=) | 100% (=) | — | 100% | 67% | 100% (=) | — | 0 (was 0) |
| named-note | 4 | 4/4 (100%) ▲ +25 pt | 100% (=) | — | 100% | 75% | 100% (=) | — | 0 (was 0) |
| follow-up | 2 | 2/2 (100%) (=) | 100% (=) | — | 100% | 50% | 100% (=) | — | 0 (was 0) |
| recent | 4 | 4/4 (100%) (=) | 94% (=) | 100% (=) | 100% | 0% | 100% (=) | — | 0 (was 0) |
| tasks | 7 | 7/7 (100%) (=) | 87% (=) | 100% (=) | 100% | 57% | 100% (=) | — | 0 (was 0) |
| not-in-vault | 3 | 3/3 (100%) (=) | — | — | 100% | — | — | 100% | 0 (was 0) |
| small-talk | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| self | 3 | 3/3 (100%) (=) | — | — | 100% | — | 100% (=) | — | 0 (was 0) |
| **overall** | 38 | 38/38 (100%) ▲ +3 pt | 96% (=) | 100% (=) | 100% | 45% | 100% (=) | 100% | 0 (was 0) |

- pass → fail: none
- fail → pass: `named-ru-plan-platform`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 6.8 s | 14.1 s | 14.6 s | 28.3 s | 7.0 |
| cross-language | 7.0 s | 16.6 s | 15.9 s | 34.8 s | 7.0 |
| named-note | 14.6 s | 15.4 s | 23.2 s | 27.7 s | 6.7 |
| follow-up | 17.5 s | 29.7 s | 26.0 s | 38.0 s | 7.0 |
| recent | 10.9 s | 17.5 s | 34.0 s | 46.6 s | 6.7 |
| tasks | 0.0 s | 23.5 s | 11.6 s | 42.0 s | 7.1 |
| not-in-vault | 5.7 s | 6.0 s | 14.7 s | 18.0 s | 6.9 |
| small-talk | 4.2 s | 4.2 s | 8.8 s | 10.5 s | 7.5 |
| self | 4.3 s | 4.3 s | 12.1 s | 14.6 s | 7.2 |
| **overall** | 6.8 s | 17.5 s | 15.9 s | 38.0 s | 7.0 |

## Error analysis

No case failed.

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

> Your current routine uses a **1:5:5** ratio (10 g starter, 50 g flour, 50 g water) with mixed rye and white bread flour. This is detailed in *Sourdough starter* (Recipes/Sourdough starter.md).
> 
> You previously used a different method involving only white flour at twice daily feedings of 1:1:1 because the old starter was too sour; have you considered whether mixing flours might help balance that acidity?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 14.1 s, total 28.3 s, search 0.7 s, 7.3 tokens/s

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

> Your goal is to run the Oslo Half Marathon on **8 November 2026** with a target time of under **1:50**.

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 8.0 s, total 12.4 s, search 0.1 s, 7.2 tokens/s

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

> The wear limit for your 11-speed chain is **0.5% elongation**. Check it every 500 km with a chain checker and replace before this threshold to protect your cassette and chainrings. 
> 
> Would you like the recommended torque values or cleaning steps next?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 11.2 s, total 20.2 s, search 0.1 s, 6.6 tokens/s

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

> Вам нужно накопить **540 000 рублей**. Это соответствует вашей цели держать резерв на полгода при ежемесячных расходах около 90 000 руб. На данный момент у вас сформировано 310 000 руб., поэтому осталось доработать ещё примерно 230 000 руб.

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 5.7 s, total 17.2 s, search 0.1 s, 6.7 tokens/s

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

> Согласно вашим заметкам, оптимальное время отхода ко сну — до **23:30**. При этом вы также фиксируете起床 time в 7:00 даже в выходные.
> 
> Хотите попробовать этот график и посмотреть на результаты завтрашнего дня?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 5.8 s, total 14.6 s, search 0.0 s, 7.0 tokens/s

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

> Du har kurs onsdager og torsdager kl. 18.00–20.00 (lærer er Ingrid). Er du klar til å øve mer på muntlig før desember?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 6.8 s, total 13.5 s, search 0.1 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · PASS

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** by embedding · “Что я решил про уведомления в Lark?” · classifier: notes 0.56 (margin 0.01) · en: решил, уведомлен, lark · 0.0 s

**Steps:** Ищу в заметках → “Идеи по монетизации”

**Tool calls:** —

**Notes in context:**
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.03)
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.02)
- 2026-09-12 — v0.3 › 2026-09-12 — v0.3: Notifications (`Projects/Lark/Lark log/2026-09-12 — v0.3.md`, score 0.02)
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 0.02)
- 2026-09-21 › 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 0.02)
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 0.02)

**Answer:**

> Вы решили ограничить напоминания максимум двумя за день и не отправлять их после 21:00, чтобы уважать часы покоя с 21:00 до 08:00. Также вы отказались от сообщений о пропущенных привычках («streak broken»), оставив только мягкие напоминания перед окончанием дня (*Lark plan*, *2026-09-12 — v0.3*).
> 
> Хотите добавить уведомления, которые будут предлагать пересмотреть цели недели?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.6 s, total 34.8 s, search 0.0 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-sourdough · cross-language · PASS

**Question:** Какое соотношение при кормлении закваски я сейчас использую?

**Router:** **notes** by embedding · “Какое соотношение при кормлении закваски я сейчас использую?” · classifier: notes 0.55 (margin 0.00) · en: какое, соотношен, кормлен, заквас, использ · 0.1 s

**Steps:** Ищу в заметках → “Sourdough starter”

**Tool calls:** —

**Notes in context:**
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 0.02)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.02)
- Сырники › Сырники (`Рецепты/Сырники.md`, score 0.02)

**Answer:**

> Сейчас вы используете соотношение **1:5:5** (частями по весу): 10 г стартера, 50 г муки и 50 г воды. Это ваш текущий режим с сентября 2026 года.
> 
> Хотите попробовать другое соотношение перед поездкой или изменением температуры?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 8.3 s, total 18.2 s, search 0.1 s, 7.1 tokens/s

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

> Ваша цель — Осло-полумарафон **8 ноября 2026 года**. Вы записали это в заметке «Running plan». Планируете ли вы сейчас пересмотреть график восстановления перед этой датой?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 13.2 s, search 0.0 s, 7.1 tokens/s

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

> You should roast the beets in foil for 40 minutes at 200 °C before grating them, as noted in your recipe (Рецепты/Борщ.md › Борщ). Would you like to check if there are any other steps I can help clarify?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 14.2 s, search 0.1 s, 7.2 tokens/s

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

> The contractor for your kitchen renovation is **Igor** (leading a team of three). The total budget is set at **450,000 rubles**.
> 
> Should I check if there are any specific tasks pending regarding the choice of backsplash tiles or ordering the sink before work starts in November?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 7.0 s, total 15.9 s, search 0.1 s, 7.2 tokens/s

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
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.02)
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 0.02)
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 0.02)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 0.01)

**Answer:**

> You decided against subscriptions or ads because a habit tracker should remain simple. Instead, you chose **free core features** for everyone, with a one-time purchase of **€12** that unlocks themes and widget styles (as noted in [[Идеи по монетизации]]). You also considered future "tipping" options (€3/5/10) to support development directly.
> 
> Would you like to draft the specific text for that €12 unlock page?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.2 s, total 29.4 s, search 0.1 s, 6.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-beta-feedback · named-note · PASS

**Question:** Look in Beta feedback - what do testers ask for most?

**Router:** **notes** by embedding · “Look in Beta feedback - what do testers ask for most?” · classifier: notes 0.60 (margin 0.02) · en: look, beta, feedba, teste, ask · 0.0 s

**Steps:** Opened → Beta feedback · Searching notes → “2026-09-25 — v0.8”

**Tool calls:** —

**Notes in context:**
- Beta feedback › Beta feedback (`Projects/Lark/Beta feedback.md`, score 0.03)
- 2026-09-25 — v0.8 › 2026-09-25 — v0.8: TestFlight beta (`Projects/Lark/Lark log/2026-09-25 — v0.8.md`, score 0.03)
- 2026-09-28 — v0.9 › 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 0.03)
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 0.03)
- Localise into Norwegian › Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 0.02)
- Weekly goals › Weekly goals (`tasks/Weekly goals.md`, score 0.02)

**Answer:**

> Testers are asking most often for **weekly goals** ("three times a week" instead of daily), which was requested by 7 out of the 12 TestFlight testers (Projects/Lark/Beta feedback.md). Other requests include pausing habits while travelling, a bigger check button in the widget, and Norwegian translation.
> 
> Would you like to prioritize implementing weekly goals next?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 11.7 s, total 23.0 s, search 0.1 s, 6.9 tokens/s

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

> Первой платформой для разработки Lark является **iOS**. Приложение будет построено на SwiftUI, а версия для Android появится только после выпуска 1.0 и достижения iOS-версией минимум 1000 еженедельных пользователей [[Lark plan]].

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 14.9 s, total 23.2 s, search 0.1 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** by embedding · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · classifier: notes 0.53 (margin 0.04) · en: check, sourdou, start, old, ratio, before · 0.1 s

**Steps:** Opened → Sourdough starter (old) · Searching notes → “Sourdough starter”

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.03)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 0.03)
- Bike maintenance manual › Bike maintenance manual > Cassette (`Long/Bike maintenance manual.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Saddle and bars (`Long/Bike maintenance manual.md`, score 0.02)

**Answer:**

> You previously used a 1:1:1 ratio for your sourdough starter in the old routine (50 g starter, 50 g flour, 50 g water). You switched away from this because it was too sour and peaked quickly.
> 
> Shall I help you draft a recipe using that specific "too sour" configuration if you ever want to experiment with high-acid loaves?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 14.6 s, total 27.7 s, search 0.1 s, 6.4 tokens/s

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
- 2026-09-18 › 2026-09-18 (`Daily/2026/09/W38/2026-09-18.md`, score 0.03)
- 2026-09-15 › 2026-09-15 (`Daily/2026/09/W38/2026-09-15.md`, score 0.03)
- 2026-09-12 — v0.3 › 2026-09-12 — v0.3: Notifications (`Projects/Lark/Lark log/2026-09-12 — v0.3.md`, score 0.02)
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.02)
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.02)

**Answer:**

> According to your notes from *Deep Work*, you aimed for **four hours** of deep work per day; Newport suggests more is rarely possible. You planned to read chapters of the book as an "option task" on September 15 and 18, but no specific daily blocks were logged in those entries yet.
> 
> Would you like to set a concrete schedule for your four-hour block today?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.4 s, total 27.6 s, search 0.1 s, 6.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · PASS

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** by model · “And where did I write that down?” · named: notifications · 9.8 s

**Steps:** Searching notes → “2026-09-12 — v0.3”

**Tool calls:** —

**Notes in context:**
- 2026-09-12 — v0.3 › 2026-09-12 — v0.3: Notifications (`Projects/Lark/Lark log/2026-09-12 — v0.3.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Saddle and bars (`Long/Bike maintenance manual.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Pedals (`Long/Bike maintenance manual.md`, score 0.02)
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.02)
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 0.02)
- 2026-09-29 › 2026-09-29 (`Daily/2026/09/W40/2026-09-29.md`, score 0.02)

**Answer:**

> You wrote this decision in the note **Lark plan (Projects/Lark/Lark plan.md › Lark plan)**, under the "Notifications" section. It specifies quiet hours from 21:00 to 08:00 and limits reminders to two per day.

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 29.7 s, total 38.0 s, search 9.8 s, 7.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · PASS

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** by model · “А где мы там ели?” · en: eating place · ru: место еды · 10.3 s

**Steps:** Ищу в заметках → “Тбилиси”

**Tool calls:** —

**Notes in context:**
- Тбилиси › Тбилиси (`Путешествия/Тбилиси.md`, score 0.02)

**Answer:**

> Початки:
> *   Хинкали — ресторан «Зодиак».
> *   Аджарский хачапури — кафе «Сакхачапуре №1».
> *   Вино — бар «Вино Андеграунд».

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 17.5 s, total 26.0 s, search 10.4 s, 7.0 tokens/s

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

> Last week you shipped the **Onboarding redesign (v0.6)**, replacing five screens with a single habit-picking screen that reduced first-day drop-off from 40% to 18%. You also implemented **Dark mode and accessibility features** in v0.7, including warm grey palettes, VoiceOver labels on every control, Dynamic Type support, and fixed contrast for the streak counter.
> 
> You sent a TestFlight beta build (v0.8) to 12 testers but encountered crashes on iOS 17.0 when habits lacked icons. Throughout this period, you also consistently worked on other tasks like writing Lark's privacy policy and buying Anna’s birthday gift.

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 17.5 s, total 39.3 s, search 0.0 s, 6.5 tokens/s

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

> Based on your notes for **23 September 2026**, here is what you recorded doing that day:
> 
> *   You worked on enabling **Dark mode** and **VoiceOver** accessibility features.
>     *   Implemented a dark palette with warm greys (keeping the amber accent).
>     *   Added VoiceOver labels to every control, enabled Dynamic Type up to the largest size, and fixed contrast issues for the streak counter.
> *   You had a scheduled or completed **"1-1"** meeting with **Maria** today (Wednesday), which involved reviewing her payments doc.
> 
> Did you also have specific tasks related to Lark that you worked on during this session?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 7.5 s, total 27.6 s, search 0.0 s, 7.0 tokens/s

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

> С момента прошлого обновления по состоянию на среду, **Lark** получил следующие изменения (см. заметку от 2026-09-30):
> 
> *   Продолжена работа над политикой конфиденциальности для релиза в App Store.
> *   Собирается бета-обратная связь: пользователь Кари хочет версию на норвежском языке.
> *   В приоритете реализация функции еженедельных целей (привычки «три раза в неделю»), так как это самая желаемая фича после фикса краша виджета во вторник.
> 
> Хотите, я помогу составить черновик политики конфиденциальности или обсудим детали реализации режима тренировок трижды в неделю?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 10.9 s, total 34.0 s, search 0.0 s, 6.9 tokens/s

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
> From this period: VoiceOver labels (done) and widget crash fix on iOS 17 (done); privacy policy for "Lark" (overdue), App Store screenshots (in progress), and Norwegian localisation (to do). Would you like to prioritise the overdue items first?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 67%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 14.4 s, search 0.0 s, 7.2 tokens/s

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
> Based on your notes, the completed items under "Lark" (or associated with that workspace) are **VoiceOver labels** and **Fix widget crash on iOS 17**. Do you need a summary of what remains open next?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 11.6 s, search 0.0 s, 7.3 tokens/s

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
> У вас одна просроченная задача: написать политику конфиденциальности (срок 26 сен). Хотите, я помогу составить её черновик прямо сейчас?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 10.3 s, search 0.0 s, 7.6 tokens/s

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
> • App Store screenshots — App Store screenshots
> • Localise into Norwegian — Localise into Norwegian
> 
> **Travel**
> • Разобрать фото из Лиссабона — 22 сен
> • успеть с подарком к дню рождения Анны — 22 сен
> 
> **Reading**
> • Write Lark privacy policy — 21 сен
> 
> **Home**
> • Try the new interval session — 23 сен
> 
> **Дом**
> • Order fibre internet for the new flat — 25 сен
> 
> **Другое**
> • Записаться к стоматологу — 23 сен
> • Отправить отчёт по расходам — 24 сен
> 
> Сделано за этот период: 5.
> 
> Ларк: написать политику конфиденциальности (21 сен), сделать скриншоты для App Store и локализовать приложение на норвежском; Дом: оформить интернет-провод в новой квартире (25 сен); Другое: записаться к стоматологу (23 сен) и отправить отчет по расходам (24 сен).

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 23.5 s, total 42.0 s, search 23.5 s, 6.8 tokens/s

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
> 
> **Reading**
> • Write Lark privacy policy — 23 Sep
> 
> **Long**
> • Try the new interval session — 23 Sep
> 
> **Other**
> • Разобрать фото из Лиссабона — 23 Sep
> • Записаться к стоматологу — 23 Sep
> 
> Still open: 6 tasks across Lark (privacy policy, screenshots), Reading (policy draft due Sep 23), Long (interval session trial), and Other (Lisbon photos, dentist appointment). Do you want to tackle the privacy policy or the photo editing first?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 11.0 s, total 25.9 s, search 11.0 s, 6.7 tokens/s

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
> You completed fixing the widget crash on iOS 17 and your long run this past weekend; would you like to see what remains open for next week?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 67%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 10.2 s, search 0.0 s, 7.3 tokens/s

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
> Следите за пунктом про проверку часовых поясов без чекбокса и завершите экспорт в JSON.

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 9.1 s, search 0.0 s, 7.1 tokens/s

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

> Based on the logs for September 21–27, here is what you accomplished:
> 
> *   **Onboarding Redesign (v0.6):** Replaced the five-screen tutorial with a single screen to let users pick up to three habits; this reduced first-day drop-off from 40% to 18%.
> *   **Accessibility & UI:** Implemented dark mode (warm greys, amber accent), added VoiceOver labels on every control, and enabled Dynamic Type.
> *   **Testing:** Released the TestFlight beta build to 12 testers; identified a crash in iOS 17 when habits have no icon.
> *   **Administrative & Personal:** Bought Anna's birthday gift, reviewed Maria's payments document (and discussed pay), submitted an expense report, and completed a long run (16 km).
> 
> Are you interested in how to address the widget crash on iOS 17?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 17.4 s, total 46.6 s, search 0.0 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** **notes** by embedding · “What's the capital of Australia?” · classifier: notes 0.45 (margin 0.02) · en: capit, austral · 1.6 s

**Steps:** Searching notes → nothing

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The context provided does not contain information about Australian capitals; I can only refer to your stored notes. However, if you are asking generally: Canberra is the capital city of Australia. Would you like me to help organize any travel or geography planning based on that fact in your vault?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 6.0 s, total 14.7 s, search 1.6 s, 6.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · PASS

**Question:** What did I write about my trip to Japan?

**Router:** **notes** by embedding · “What did I write about my trip to Japan?” · classifier: notes 0.76 (margin 0.12) · en: write, trip, japan · 0.0 s

**Steps:** Searching notes → nothing

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> There are no notes in your vault regarding a trip to Japan. Would you like to start planning or recording details for that journey now?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 4.6 s, total 8.5 s, search 0.1 s, 7.1 tokens/s

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

> В текущем контексте (ноутбук «Идеи по монетизации») о решении касательно подписки на Netflix не говорится — там речь только о модели монетизации приложения с трекером привычек. Если вы хотите обсудить это, могу предложить идеи: например, как сэкономить в долгосрочной перспективе или альтернативные платформы для контента по интересам.

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 5.7 s, total 18.0 s, search 0.1 s, 7.0 tokens/s

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

> Hello! I am Recto, ready to help with your vault. What would you like to explore today?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.2 s, total 7.1 s, search 0.0 s, 7.9 tokens/s

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

> Рада слышать! Чем еще могу быть полезна? Может, стоит взглянуть на открытые задачи или обсудить новую идею для заметок?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.2 s, total 8.8 s, search 0.0 s, 7.3 tokens/s

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

> I'm ready when you are! What would you like to explore or organize from the vault today? Maybe we could review a specific topic, plan something new based on your notes, or just see what connections exist between your entries?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.2 s, total 10.5 s, search 0.0 s, 7.5 tokens/s

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

> I am Recto, your personal vault keeper designed to think with your specific notes and help organize them. If you have questions about what we've recorded or need assistance planning based on our context, ask away! Did a particular project of yours spark this curiosity today?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.3 s, total 12.1 s, search 0.0 s, 6.9 tokens/s

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

> В моих записях нет конкретных дат, указывающих на год их создания или последнего обновления. Я работаю только с тем текстом, который был передан мне в контексте этого хранилища. Если вы хотите узнать хронологию событий из ваших заметок, уточните тему, и я проверу, есть ли там упоминания дат.

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.2 s, total 14.6 s, search 0.0 s, 7.3 tokens/s

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

> Your notes are stored in this vault and not shared outside of our conversation here. Would you like me to review your current collection or suggest how to organize specific folders?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.3 s, total 9.0 s, search 0.0 s, 7.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
