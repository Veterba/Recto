---
run_id: "2026-10-03 15-31 — B first- hybrid, names, classifier, scope tools"
date: 2026-10-03T13:31:30.913Z
model: qwen3.5:9b
commit: e314161 (dirty)
report_version: 1
compared_to: "2026-10-03 15-20 — smoke- part B pipeline"
---

# Recto Eval: B first: hybrid, names, classifier, scope tools

## Summary

Compared to "2026-10-03 15-20 — smoke- part B pipeline", what changed: nothing in the setup (same model, code, prompt and cases) - differences are the model’s own variation. 34 of 38 cases pass (89%), recall@4 85%, time to first token 4.5 s at the median (p90 13.6 s), 10.9 tokens/s. Pass rate 50% → 89%, recall@4 75% → 85%, TTFT p50 19.5 s → 4.5 s. Biggest win: named-note (▲ +50 pt). No kind got worse.

## Setup

- Model: qwen3.5:9b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: none)
- Speed check before the run: 15.4 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"qwen3.5","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router on, classifier on, taskIndex on, looseTasks on, hybridRetrieval on, namedNotes on, scopeTools on, noteCards on, tools off, stickyContext on, steps on
- SYSTEM.md: sha256 `fc475e8d2362` (full text in config.json)
- Vault: fixture vault, 64 notes (ru 25, en 36, no 3); today = 2026-09-30
- Built before the run: chunk vectors for 64 notes (91 pieces embedded) in 7.8 s; note cards 64/64 in 0.0 s (cached cards reused)
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

- **recall@4**: 85%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 52%. The answer names at least one expected note by title.
- **sources-correct**: 94%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **items**: 100%. For tasks and recent cases, the share of the expected items the answer names (either wording); under 75% fails the case.
- **router accuracy**: 100%. The router's kind matches the case's (notes / recent / tasks / smalltalk / self / review / advice); — before the router exists. Decided by rules 17, by the example questions 19, by the model 2.
- **ungrounded claims**: 1. Notes the answer names or links that were not in its context (not retrieved, not read by a tool). Judged on the model's own words, not on a list the harness wrote; a quoted phrase that is also in the notes it was given is a quote, not a claim. Must be 0; each is listed under Error analysis.
- **decoys**: a note listed as forbidden for a case (the math notes full of «задачи») in its context fails the case.
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 4.5 s, p90 13.6 s — from the question to the first token, including the vault search.
- **total time** p50 10.3 s, p90 28.7 s — from the question to the last token.
- **tokens/sec**: 10.9. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.3 GB resident, the model 5.7 GB by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app 0.8 GB; swap used 5.8 GB before → 5.6 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) | 100% | — | 100% | 50% | 100% | — | 0 |
| cross-language | 6 | 5/6 (83%) | 83% | — | 100% | 67% | 100% | — | 0 |
| named-note | 4 | 4/4 (100%) | 100% | — | 100% | 100% | 100% | — | 0 |
| follow-up | 2 | 1/2 (50%) | 50% | — | 100% | 50% | 50% | — | 1 |
| recent | 4 | 4/4 (100%) | 94% | 100% | 100% | 0% | 100% | — | 0 |
| tasks | 7 | 5/7 (71%) | 70% | 100% | 100% | 43% | 86% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | 100% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 34/38 (89%) | 85% | 100% | 100% | 52% | 94% | 100% | 1 |

## Compared to 2026-10-03 15-20 — smoke- part B pipeline

| Kind | Cases | Pass | recall@4 | Items | Router | Named in answer | Sources correct | Honest | Ungrounded |
|---|---|---|---|---|---|---|---|---|---|
| same-language | 6 | 6/6 (100%) | 100% | — | 100% | 50% | 100% | — | 0 |
| cross-language | 6 | 5/6 (83%) | 83% | — | 100% | 67% | 100% | — | 0 |
| named-note | 4 | 4/4 (100%) ▲ +50 pt | 100% ▲ +25 pt | — | 100% | 100% | 100% ▲ +25 pt | — | 0 (was 2) |
| follow-up | 2 | 1/2 (50%) | 50% | — | 100% | 50% | 50% | — | 1 |
| recent | 4 | 4/4 (100%) | 94% | 100% | 100% | 0% | 100% | — | 0 |
| tasks | 7 | 5/7 (71%) | 70% | 100% | 100% | 43% | 86% | — | 0 |
| not-in-vault | 3 | 3/3 (100%) | — | — | 100% | — | — | 100% | 0 |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| self | 3 | 3/3 (100%) | — | — | 100% | — | 100% | — | 0 |
| **overall** | 38 | 34/38 (89%) ▲ +39 pt | 85% ▲ +10 pt | 100% | 100% | 52% | 94% ▲ +19 pt | 100% | 1 (was 2) |

- pass → fail: none
- fail → pass: `named-beta-feedback`, `named-deep-work`
- grades from the compared run: none

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 4.3 s | 11.6 s | 9.0 s | 17.1 s | 14.9 |
| cross-language | 6.4 s | 16.9 s | 12.7 s | 26.4 s | 9.3 |
| named-note | 10.7 s | 12.4 s | 17.0 s | 20.1 s | 9.9 |
| follow-up | 13.4 s | 21.0 s | 19.2 s | 31.4 s | 9.7 |
| recent | 8.3 s | 13.6 s | 21.2 s | 33.8 s | 9.9 |
| tasks | 0.6 s | 20.9 s | 10.2 s | 28.9 s | 9.8 |
| not-in-vault | 3.8 s | 4.7 s | 8.9 s | 10.3 s | 10.4 |
| small-talk | 3.4 s | 3.7 s | 5.3 s | 6.4 s | 12.5 |
| self | 3.5 s | 3.7 s | 9.1 s | 9.3 s | 10.4 |
| **overall** | 4.5 s | 13.6 s | 10.3 s | 28.7 s | 10.9 |

## Error analysis

- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Write privacy policy, Bike maintenance manual, Lark log, 2026-09-28; ungrounded claim: named “Lark plan” without having it
- `tasks-open-last-week` (tasks) — wrong note: expected App Store screenshots, Localise into Norwegian, VoiceOver labels; read 2026-09-21
- `cross-ru-en-notifications` (cross-language) — wrong note: expected Lark plan; read Идеи по монетизации, 2026-09-21, 2026-09-29, 2026-09-30
- `tasks-real-ru-last-week` (tasks) — retrieval miss: expected 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; read 2026-09-22, Write privacy policy, 2026-09-21, App Store screenshots

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 1 |
| wrong note | 3 |
| ungrounded claim | 1 |

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

> Your current routine uses a **1:5:5** ratio (10 g starter, 50 g flour, 50 g water). This is based on your notes from *Sourdough starter*, where you switched to this method in September 2026 after finding the old frequent feedings too sour.
> 
> Would you like advice on how to maintain it during a long trip?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 11.6 s, total 17.1 s, search 0.6 s, 15.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### same-half-marathon · same-language · PASS

**Question:** When is my half marathon, and what time am I aiming for?

**Router:** **notes** by embedding · “When is my half marathon, and what time am I aiming for?” · classifier: notes 0.59 (margin 0.05) · en: half, marath, time, aiming · 0.0 s

**Steps:** Searching notes → “Running plan”

**Tool calls:** —

**Notes in context:**
- Running plan › Running plan (`Health/Running plan.md`, score 0.03)
- 2026-09-27 › 2026-09-27 (`Daily/2026/09/W39/2026-09-27.md`, score 0.02)

**Answer:**

> Your goal is to run the Oslo Half Marathon on **8 November 2026**, with a target time of under **1:50**.

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 4.4 s, total 6.5 s, search 0.1 s, 15.5 tokens/s

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

> The wear limit for an 11-speed chain is **0.5% elongation**. You should measure it every 500 km with a chain checker and replace it at this threshold to prevent accelerated wear on your cassette and chainrings (from *Bike maintenance manual > Chain*).

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 6.3 s, total 10.3 s, search 0.1 s, 15.2 tokens/s

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

> Вам нужно накопить **540 000 рублей** (это сумма ваших расходов за 6 месяцев: около 90 000 ₽ × 6). Сейчас у вас уже есть 310 000, поэтому осталось собрать еще примерно 230 000.
> 
> Хотите обсудить план по откладыванию недостающей суммы?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 3.5 s, total 9.0 s, search 0.1 s, 15.2 tokens/s

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

> Лучше всего вам ложиться до 23:30. При соблюдении этого правила (а также утреннего подъема в 7:00) вы спите около 7,5 часов и просыпаетесь без будильника.
> 
> Хотели бы обсудить другие аспекты вашего режима сна?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 3.6 s, total 8.3 s, search 0.1 s, 14.7 tokens/s

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

> Du har norskkurs tirsdager og torsdager kl. 18.00–20.00 hos Folkeuniversitetet med lærer Ingrid (jfr. *Norskkurs*). Vil du at vi planlegger øving på muntlig norsk før eksamen i desember?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.3 s, total 9.3 s, search 0.1 s, 13.7 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### cross-ru-en-notifications · cross-language · FAIL

**Question:** Что я решил про уведомления в Lark?

**Router:** **notes** by embedding · “Что я решил про уведомления в Lark?” · classifier: notes 0.56 (margin 0.01) · en: решил, уведомлен, lark · 0.1 s

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

> Вы решили ограничить уведомления двумя сообщениями в день и не отправлять их после 21:00, чтобы соблюдать режим тишины с 21:00 до 08:00. Также вы запретили сообщать о пропущенных сериях («серию сломал»), оставив только мягкие напоминания перед концом дня.
> 
> Хотите обсудить стратегию настройки этих уведомлений для бета-тестирования?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct true, honest —, language ok — wrong note

**Timings:** TTFT 11.2 s, total 20.5 s, search 0.1 s, 10.9 tokens/s

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

> Сейчас вы используете соотношение **1:5:5** (закваска, мука, вода). Это часть вашей текущей рутины с сентября 2026 года.
> 
> Хотите узнать детали этого процесса или обсудить возможные изменения в рационе закваски?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 6.4 s, total 12.7 s, search 0.1 s, 10.3 tokens/s

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

> Ваша цель — полузагон в Осло **8 ноября 2026 года** (из файла `Running plan.md`). Нужно ли продумать план восстановления после этой даты?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.5 s, total 8.9 s, search 0.1 s, 9.1 tokens/s

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

> You should roast the beets in foil at 200 °C for 40 minutes, according to your note "Борщ (Рецепты/Борщ.md › Борщ)".
> 
> Do you have any other vegetables that need specific prep times before adding them to the soup?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 5.0 s, total 12.4 s, search 0.0 s, 8.3 tokens/s

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

> The contractor for your kitchen renovation (**Ремонт кухни**) is **Igor** (a crew of three people), with a total budget of **450,000 rubles**. The work was scheduled to start on November 3rd and last four weeks.

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.0 s, total 16.0 s, search 0.0 s, 8.2 tokens/s

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

> You decided that tracking habits should remain simple and ad-free. Instead of subscriptions, you chose a one-time purchase model: everything core is free for everyone, while €12 unlocks themes and widget styles. You also considered later adding voluntary "tips" to the developer at 3€, 5€, or 10€. This approach avoids subscription fatigue [[Идеи по монетизации], [Lark plan]].

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.9 s, total 26.4 s, search 0.1 s, 9.1 tokens/s

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

> In **Beta feedback**, the feature requested most often is **weekly goals** (specifically "three times a week" instead of daily), asked by 7 out of 12 testers.
> 
> Do you want to update your implementation plan or notes with this priority change?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 12.4 s, total 18.1 s, search 0.0 s, 9.9 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-ru-plan-platform · named-note · PASS

**Question:** Посмотри в Lark plan, какая платформа первая?

**Router:** **notes** by embedding · “Посмотри в Lark plan, какая платформа первая?” · classifier: notes 0.55 (margin 0.01) · en: посмот, lark, plan, платфор, первая · 0.0 s

**Steps:** Ищу в заметках → “Lark plan”

**Tool calls:** —

**Notes in context:**
- Lark plan › Lark plan (`Projects/Lark/Lark plan.md`, score 0.03)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 0.02)
- Lark ideas › Lark ideas (`Projects/Lark/Lark ideas.md`, score 0.02)
- Идеи по монетизации › Идеи по монетизации Lark (`Проекты/Lark/Идеи по монетизации.md`, score 0.02)

**Answer:**

> В первой строке **Lark plan.md** указано: *iOS first*. Приложение сначала разрабатывается на iOS (SwiftUI), а версия для Android появится только после 1.0.
> 
> Хочешь обсудить приоритеты разработки под конкретную платформу?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 11.2 s, total 17.0 s, search 0.1 s, 10.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### named-old-starter · named-note · PASS

**Question:** Check [[Sourdough starter (old)]] - what ratio did I use before?

**Router:** **notes** by embedding · “Check [[Sourdough starter (old)]] - what ratio did I use before?” · classifier: notes 0.53 (margin 0.04) · en: check, sourdou, start, old, ratio, use, before · 0.0 s

**Steps:** Opened → Sourdough starter (old) · Searching notes → “Sourdough starter”

**Tool calls:** —

**Notes in context:**
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 0.03)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 0.03)
- Bike maintenance manual › Bike maintenance manual > Cassette (`Long/Bike maintenance manual.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Saddle and bars (`Long/Bike maintenance manual.md`, score 0.02)

**Answer:**

> You used a **1:1:1** feeding ratio with only white flour for your previous routine ("[[Sourdough starter (old)]](Recipes/Sourdough%20starter%20(old)).md › Sourdough starter (old)"). This resulted in the starter being too sour and peaking in just 3 hours, which led to switching to a new method.
> 
> Did you want to compare this old ratio with your current one?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 10.7 s, total 20.1 s, search 0.1 s, 9.9 tokens/s

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

> Based on your notes in *Deep Work*, you aimed to reach **four hours** of deep work per day. Newport suggests that trying more than this is rarely possible without diminishing returns.
> 
> Did you plan any specific blocks today toward hitting that four-hour target, or was the read-through just a chapter review?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.6 s, total 15.9 s, search 0.1 s, 10.0 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-notifications-where · follow-up · FAIL

> You: What did I decide about notifications in Lark?
> Recto: At most two reminders a day, and never after 21:00.

**Question:** And where did I write that down?

**Router:** **notes** by model · “And where did I write that down?” · named: notifications · 7.1 s

**Steps:** Opened → Write privacy policy · Searching notes → “Bike maintenance manual”

**Tool calls:** —

**Notes in context:**
- Write privacy policy › Write privacy policy (`tasks/Write privacy policy.md`, score 1.00)
- Bike maintenance manual › Bike maintenance manual > Saddle and bars (`Long/Bike maintenance manual.md`, score 0.02)
- Bike maintenance manual › Bike maintenance manual > Pedals (`Long/Bike maintenance manual.md`, score 0.02)
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 0.01)
- 2026-09-28 › 2026-09-28 (`Daily/2026/09/W40/2026-09-28.md`, score 0.01)

**Answer:**

> You wrote that decision regarding the frequency (two per day) and timing (no alarms after 21:00) in your notes about **notifications**. However, looking at the current vault context for "Lark", there is no specific note explicitly detailing those notification rules yet. The index lists `[[Lark plan]]`, but its contents are not included here.
> 
> Did you perhaps write that detail in a separate draft or intend to add it to a future version log?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — wrong note, ungrounded claim

**Timings:** TTFT 21.0 s, total 31.4 s, search 7.1 s, 9.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### follow-ru-tbilisi-food · follow-up · PASS

> You: Расскажи про поездку в Тбилиси
> Recto: В мае 2026 вы были в Тбилиси пять дней, жили в хостеле «Фабрика», ходили в серные бани.

**Question:** А где мы там ели?

**Router:** **notes** by model · “А где мы там ели?” · en: eating place · ru: место еды · 8.0 s

**Steps:** Ищу в заметках → “Тбилиси”

**Tool calls:** —

**Notes in context:**
- Тбилиси › Тбилиси (`Путешествия/Тбилиси.md`, score 0.02)

**Answer:**

> Ели: хинкали в «Зодиаке», хачапури по-аджарски в «Сакхачапуре №1», вино в баре «Вино Андеграунд». А что еще запомнилось из еды?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 13.4 s, total 19.2 s, search 8.0 s, 9.9 tokens/s

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

> Last week you shipped the **v0.6 Onboarding redesign** (replacing five screens with one habit picker, dropping first-day drop-off from 40% to 18%), released **v0.7 Dark mode and accessibility** features (warm greys, amber accent, VoiceOver labels), launched a **TestFlight beta** for v0.8 on Sept 25 (two iOS 17 crashes reported when widgets lack icons), reviewed Maria's payments doc, and bought Anna’s birthday gift.
> 
> My suggestions:  
> - The unresolved "Write Lark privacy policy" task should be prioritized before the next public release to comply with App Store requirements. Would you like a template or checklist for this?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 13.3 s, total 28.7 s, search 0.0 s, 9.7 tokens/s

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

> The notes show that for **Wednesday, 2026-09-23**, you focused on implementing **Dark mode** and **VoiceOver** accessibility features (including warm grey palettes, amber accents, VoiceOver labels, and Dynamic Type). You also listed tasks to write a Lark privacy policy, buy a gift for Anna's birthday, see a dentist, review Maria's payments doc, sort Lisbon photos, and try a new interval session.
> 
> There is no specific entry labeled "Wednesday last week" (which would be **September 16**); the provided context only contains notes from September 23. Would you like me to help draft an idea for what that Wednesday might have involved based on your current projects?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 21.2 s, search 0.0 s, 10.0 tokens/s

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

> С 30 сентября (понедельник): планировали выпуск версии для App Store, работали над политикой конфиденциальности и продолжали сбор бета-обратной связи от пользователей. Также упоминалось, что Kari хочет норвежский язык в приложении.

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 8.3 s, total 13.9 s, search 0.0 s, 10.8 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-last-week · tasks · FAIL

**Question:** Which Lark tasks from last week are still open, and which are done?

**Router:** **tasks** by rules · “Which Lark tasks from last week are still open, and which are done?” · en: lark, tasks, last, week, still, open · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** Tasks → 1 open in 1 groups

**Tool calls:** 
- `tasks_in_period(Lark, note)` by the harness → 1 open in 1 groups: 2026-09-21

**Notes in context:**
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 3.00)

**Answer:**

> Still open: 1 tasks in 1 groups.
> 
> **2026-09-21**
> • Write Lark privacy policy — 21 Sep
> 
> Done in this period: 5.
> 
> Tasks remaining: Write Lark privacy policy (2026-09-21). Done in this period: 5. Would you like to discuss the content for that privacy policy now?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 20.9 s, total 28.9 s, search 20.9 s, 10.2 tokens/s

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
> Done: VoiceOver labels and Fix widget crash on iOS 17. Should I help you plan the next items for your open tasks?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; items widget crash, VoiceOver; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.0 s, total 11.1 s, search 4.0 s, 10.7 tokens/s

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
> У вас одна просроченная задача: написание политики конфиденциальности (срок был 26 сентября). Хотите, я помогу составить черновик прямо сейчас?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 8.5 s, search 0.0 s, 9.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-real-ru-last-week · tasks · FAIL

**Question:** что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику

**Router:** **tasks** by rules · “что я не доделал с прошлой недели, посмотри все задачи, а не только одну специфику” · en: додел, прошл, недели, посмот, задачи, одну, специфи · period 2026-09-21..2026-09-27 · 0.0 s

**Steps:** Задачи → 10 open in 9 groups

**Tool calls:** 
- `tasks_in_period(2026-09-21, 2026-09-27, open, topic)` by the harness → 10 open in 9 groups: 2026-09-22, Write privacy policy, 2026-09-21, App Store screenshots, 2026-09-23, 2026-09-24, Localise into Norwegian, 2026-09-25

**Notes in context:**
- 2026-09-22 (`Daily/2026/09/W39/2026-09-22.md`, score 3.00)
- Write privacy policy (`tasks/Write privacy policy.md`, score 2.90)
- 2026-09-21 (`Daily/2026/09/W39/2026-09-21.md`, score 2.80)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.70)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.60)
- 2026-09-24 (`Daily/2026/09/W39/2026-09-24.md`, score 2.50)
- Localise into Norwegian (`tasks/Localise into Norwegian.md`, score 2.40)
- 2026-09-25 (`Daily/2026/09/W39/2026-09-25.md`, score 2.30)

**Answer:**

> Не доделано: 10 — по 9 темам.
> 
> **Другое**
> • Разобрать фото из Лиссабона — 22 сен
> • успеть с подарком к дню рождения Анны — 22 сен
> 
> **Work**
> • Write privacy policy — Write privacy policy
> 
> **Lark**
> • Write Lark privacy policy — 21 сен
> 
> **Long**
> • App Store screenshots — App Store screenshots
> 
> **Мысли**
> • Записаться к стоматологу — 23 сен
> 
> **Health**
> • Try the new interval session — 23 сен
> 
> **Работа**
> • Отправить отчёт по расходам — 24 сен
> 
> **Norsk**
> • Localise into Norwegian — Localise into Norwegian
> 
> **Home**
> • Order fibre internet for the new flat — 25 сен
> 
> Сделано за этот период: 5.
> 
> Недоделано 10 задач по темам: Другое (фото из Лиссабона, подарок Анне), Work (политика конфиденциальности), Lark и Norsk (локализация) — все дедлайны на конец этой недели.

**Expected:** notes 2026-09-21, 2026-09-23, 2026-09-24, 2026-09-25; items privacy policy|политик, стоматолог|dentist, отчёт по расходам|expense report, fibre|интернет; never Линейные уравнения, Квадратные уравнения; answer Открыто: Write Lark privacy policy, записаться к стоматологу, отправить отчёт по расходам, Order fibre internet (+ фото из Лиссабона, интервалы, карточки App Store screenshots и Localise into Norwegian). Сделано: подарок Ане, документ Марии, пробежка 16 км.

**Scores:** recall@4 25%, named in answer false, sources correct true, honest —, language ok — retrieval miss

**Timings:** TTFT 0.6 s, total 12.9 s, search 0.6 s, 9.4 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### tasks-open-wednesday · tasks · PASS

**Question:** What's still open from Wednesday?

**Router:** **tasks** by rules · “What's still open from Wednesday?” · en: still, open, wednesd · period 2026-09-23..2026-09-23 · 0.0 s

**Steps:** Tasks → 6 open in 6 groups

**Tool calls:** 
- `tasks_in_period(2026-09-23, 2026-09-23, open, topic)` by the harness → 6 open in 6 groups: Write privacy policy, App Store screenshots, 2026-09-23

**Notes in context:**
- Write privacy policy (`tasks/Write privacy policy.md`, score 3.00)
- App Store screenshots (`tasks/App Store screenshots.md`, score 2.90)
- 2026-09-23 (`Daily/2026/09/W39/2026-09-23.md`, score 2.80)

**Answer:**

> Still open: 6 tasks in 6 groups.
> 
> **Work**
> • Write privacy policy — Write privacy policy
> 
> **Long**
> • App Store screenshots — App Store screenshots
> 
> **Lark**
> • Write Lark privacy policy — 23 Sep
> 
> **Дом**
> • Разобрать фото из Лиссабона — 23 Sep
> 
> **Мысли**
> • Записаться к стоматологу — 23 Sep
> 
> **Health**
> • Try the new interval session — 23 Sep
> 
> Still open are six tasks across Work, Long, Lark, Дом, Мысли, and Health groups (e.g., writing privacy policies and scheduling dental visits). Would you like help prioritizing which one to tackle first?

**Expected:** notes 2026-09-23; items privacy policy, dentist|стоматолог; never Линейные уравнения, Квадратные уравнения; answer From last Wednesday (23 Sep) still open - Write Lark privacy policy, Записаться к стоматологу (and the optional photo sorting and interval session).

**Scores:** recall@4 100%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.6 s, total 10.2 s, search 0.6 s, 9.6 tokens/s

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
> I don't have information about your tasks from last week; could you clarify which specific time period you'd like me to review in this vault?

**Expected:** notes 2026-09-24, 2026-09-25, 2026-09-27; items gift|подар, Maria|Мари, 16 km|long run; never Линейные уравнения, Квадратные уравнения; answer The gift for Anna (25 Sep), Maria's payments doc (24 Sep), the 16 km long run (27 Sep), VoiceOver labels.

**Scores:** recall@4 67%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 7.6 s, search 0.0 s, 10.0 tokens/s

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
> Остаётся завершить экспорт в JSON и проверить работу с часовыми поясами без чекбокса; хотите, чтобы я помог составить план этих шагов?

**Expected:** notes Экспорт; items JSON; never Линейные уравнения, Квадратные уравнения; answer Доделать экспорт в JSON до релиза 20 октября (сейчас без истории отметок) и проверить часовые пояса - это не чекбокс, а текст в заметке «Экспорт».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 0.0 s, total 7.8 s, search 0.0 s, 9.7 tokens/s

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

> Last week you:
> *   Shipped the **Onboarding redesign (v0.6)**, replacing the five-screen tutorial with one screen and dropping first-day drop-off from 40% to 18%.
> *   Implemented **Dark mode** (warm greys, amber accent) and full accessibility support including VoiceOver labels and Dynamic Type in v0.7.
> *   Released a **TestFlight beta (v0.8)** to 12 testers; fixed widget crashes on iOS 17.0 when habits lack icons.
> *   Completed personal tasks: bought Anna's birthday gift, reviewed Maria's payment document, went for a 16 km run in 1:32.
> 
> Still pending from that week (or carried over): writing the Lark privacy policy and recording with your dentist.
> 
> Did you try to address the remaining crashes or localisation requests yet?

**Expected:** notes 2026-09-21, 2026-09-22, 2026-09-23, 2026-09-24, 2026-09-25, 2026-09-27; items onboarding, dark mode|VoiceOver, TestFlight|beta, 16 km|long run; answer Onboarding redesign, dark mode and VoiceOver, the TestFlight beta, 1-1 with Maria, the gift for Anna, a 16 km long run.

**Scores:** recall@4 75%, named in answer false, sources correct true, honest —, language ok

**Timings:** TTFT 13.6 s, total 33.8 s, search 0.0 s, 9.2 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-australia · not-in-vault · PASS

**Question:** What's the capital of Australia?

**Router:** **notes** by embedding · “What's the capital of Australia?” · classifier: notes 0.45 (margin 0.02) · en: capit, austral · 0.0 s

**Steps:** Searching notes → nothing

**Tool calls:** —

**Notes in context:**
- none

**Answer:**

> The context provided does not contain information about Australian geography or its capitals, as there are no matching notes in the vault regarding this topic. 
> 
> My suggestions: The capital city is Canberra. Would you like to add a note on world capitals for future reference?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 3.8 s, total 8.9 s, search 0.1 s, 10.1 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note: 

### notin-japan · not-in-vault · PASS

**Question:** What did I write about my trip to Japan?

**Router:** **notes** by embedding · “What did I write about my trip to Japan?” · classifier: notes 0.76 (margin 0.12) · en: write, trip, japan · 0.0 s

**Steps:** Opened → Write privacy policy · Searching notes → nothing

**Tool calls:** —

**Notes in context:**
- Write privacy policy › Write privacy policy (`tasks/Write privacy policy.md`, score 1.00)

**Answer:**

> The current notes in the vault do not contain any information about a trip to Japan. Did you perhaps mean our work on the privacy policy note?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 3.7 s, total 6.5 s, search 0.1 s, 11.0 tokens/s

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

> В предоставленных заметках из раздела «Идеи по монетизации» нет информации о том, что вы решили касательно подписки на Netflix. Там обсуждается лишь модель монетизации для трекера привычек (отказ от подписок и рекламы).

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 4.7 s, total 10.3 s, search 0.1 s, 10.2 tokens/s

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

> Hello, Recto here. The vault is open and waiting for your first query—would you like me to summarize a topic or point out related notes?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.4 s, total 6.4 s, search 0.0 s, 10.5 tokens/s

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

> Рад помочь! Если возникнут новые вопросы или заметки нужно будет разобрать — обращайся. Что сейчас важно?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.3 s, total 5.3 s, search 0.0 s, 12.8 tokens/s

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

> Glad you like it! Is there a specific topic in your vault we should dive into today?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.7 s, total 5.2 s, search 0.0 s, 14.1 tokens/s

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

> I am Recto, your vault keeper. I hold and think with the specific notes provided in our context—not a general-purpose AI answering from open-ended knowledge unless asked for suggestions or ideas outside those bounds. Do you have something we should organize within these notes today?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.7 s, total 8.9 s, search 0.0 s, 10.4 tokens/s

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

> В моих записях нет информации о конкретном году создания этого хранилища или датировке его содержания, если вы сами не указали её в заметках. Если вам нужно проверить даты событий из ваших текстов — уточните тему, и я найду соответствующие записи.

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.5 s, total 9.1 s, search 0.0 s, 10.4 tokens/s

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

> Based on the context I have access to, there is no record of your notes being transmitted or stored outside this vault session. Your data remains within our current interaction window unless you explicitly configure otherwise in a broader application setting. Did you mean to ask about how long these specific notes will persist here?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.5 s, total 9.3 s, search 0.0 s, 10.3 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
