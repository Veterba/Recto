---
run_id: "2026-10-03 10-55 — baseline"
date: 2026-10-03T08:55:09.271Z
model: gemma4:e4b
commit: b02b0ea (dirty)
report_version: 1
compared_to: none
---

# Recto Eval: baseline

## Summary

First run of this kind: gemma4:e4b on the fixture vault, labelled "baseline". 15 of 33 cases pass (45%), recall@4 29%, time to first token 3.1 s at the median (p90 7.5 s), 7.8 tokens/s. Nothing to compare with yet, so this is the baseline later runs are measured against.

## Setup

- Model: gemma4:e4b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: gemma4:12b)
- Speed check before the run: 23.7 tokens/s (a throttling Mac shows under 5)
- Profile: `{"family":"gemma4","tested":true,"thinking":"param","options":{"num_ctx":8192,"num_predict":600,"temperature":0.7},"tools":"ollama"}`
- Harness: router off, hybrid retrieval off, named notes off, tools off, sticky context off
- SYSTEM.md: sha256 `70c6d0884cf0` (full text in config.json)
- Vault: fixture vault, 46 notes (en 31, no 3, ru 12); today = 2026-09-30
- Cases: tests/bots/eval/cases.yaml (sha256 `6990d39f8a68`)
- Machine: Apple M3, 16 GB RAM
- Code: feature/recto-rag-v1 @ b02b0ea with uncommitted changes, app 0.9.3

## Dataset

33 cases; questions in en 20, ru 12, no 1; 30 with an expected answer, 2 with earlier turns.

| Kind | Cases |
|---|---|
| same-language | 6 |
| cross-language | 6 |
| named-note | 4 |
| follow-up | 2 |
| recent | 3 |
| tasks | 3 |
| not-in-vault | 3 |
| small-talk | 3 |
| self | 3 |

## Metrics

- **recall@4**: 29%. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.
- **note-named-in-answer**: 38%. The answer names at least one expected note by title.
- **sources-correct**: 40%. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.
- **not-in-vault honesty**: 100%. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).
- **my grade**: — (nothing graded yet) — boxes ticked in the compared run's report (this run's are graded after it is read).
- **TTFT** p50 3.1 s, p90 7.5 s — from the question to the first token, including the vault search.
- **total time** p50 6.1 s, p90 15.5 s — from the question to the last token.
- **tokens/sec**: 7.8. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 7.0 GB resident, the model 0.3 GB by Ollama's count, the app 0.4 GB; swap used 6.6 GB before → 5.7 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Named in answer | Sources correct | Honest |
|---|---|---|---|---|---|---|
| same-language | 6 | 4/6 (67%) | 67% | 67% | 67% | — |
| cross-language | 6 | 0/6 (0%) | 0% | 0% | 0% | — |
| named-note | 4 | 2/4 (50%) | 50% | 100% | 50% | — |
| follow-up | 2 | 1/2 (50%) | 50% | 50% | 50% | — |
| recent | 3 | 0/3 (0%) | 0% | 0% | 0% | — |
| tasks | 3 | 0/3 (0%) | 0% | 0% | 0% | — |
| not-in-vault | 3 | 3/3 (100%) | — | — | — | 100% |
| small-talk | 3 | 3/3 (100%) | — | — | 100% | — |
| self | 3 | 2/3 (67%) | — | — | 67% | — |
| **overall** | 33 | 15/33 (45%) | 29% | 38% | 40% | 100% |

## Compared to nothing (first run)

No earlier run to compare with.

## Latency

| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |
|---|---|---|---|---|---|
| same-language | 2.4 s | 9.4 s | 6.7 s | 12.4 s | 11.5 |
| cross-language | 3.2 s | 3.6 s | 4.8 s | 10.7 s | 7.2 |
| named-note | 5.3 s | 9.3 s | 14.7 s | 16.6 s | 6.4 |
| follow-up | 4.6 s | 7.5 s | 10.9 s | 16.5 s | 6.9 |
| recent | 3.0 s | 3.1 s | 4.2 s | 9.2 s | 7.8 |
| tasks | 3.1 s | 3.2 s | 7.2 s | 9.0 s | 6.4 |
| not-in-vault | 3.1 s | 4.0 s | 4.3 s | 15.5 s | 8.0 |
| small-talk | 3.0 s | 3.1 s | 4.6 s | 4.9 s | 6.1 |
| self | 3.2 s | 4.4 s | 5.9 s | 6.1 s | 7.1 |
| **overall** | 3.1 s | 7.5 s | 6.1 s | 15.5 s | 7.8 |

## Error analysis

- `named-beta-feedback` (named-note) — ignored named note: expected Beta feedback; read Localise into Norwegian, Lark log, 2026-09-28 — v0.9
- `named-ru-plan-platform` (named-note) — ignored named note: expected Lark plan; read Lark log
- `follow-notifications-where` (follow-up) — wrong note: expected Lark plan; read Bike maintenance manual
- `cross-ru-en-sourdough` (cross-language) — retrieval miss: expected Sourdough starter; read nothing
- `cross-ru-en-marathon` (cross-language) — retrieval miss: expected Running plan; read nothing

Failures (and slow answers) per reason, across all cases:

| Reason | Cases |
|---|---|
| retrieval miss | 13 |
| wrong note | 2 |
| ignored named note | 2 |
| unneeded retrieval | 1 |

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

> The current routine uses a 1:5:5 ratio when feeding your starter once a day (Sourdough starter). Are you referring to the current routine or the old one from 2025?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.4 s, total 12.4 s, search 0.0 s, 14.8 tokens/s

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

> Your Oslo half marathon is on 8 November 2026 (Running plan). You are aiming to run it under 1:50 (Running plan).
> 
> Did you start tracking your long run progression yet?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 2.0 s, total 5.1 s, search 0.0 s, 14.8 tokens/s

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

> The wear limit for an 11-speed chain is 0.5% elongation (Bike maintenance manual.md › Chain). Did you also check the wear limits for your 8- and 9-speed chains?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 3.0 s, total 6.7 s, search 0.0 s, 12.9 tokens/s

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

> Вам нужно 540 000 рублей для подушки безопасности, так как ваши расходы в месяц около 90 000 рублей и вы решили держать подушку на 6 месяцев расходов (Подушка безопасности.md › Подушка безопасности).
> 
> Вы уже накопили 310 000 рублей (Подушка безопасности.md › Подушка безопасности). Что планируете делать с текущими накоплениями?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 2.4 s, total 9.8 s, search 0.0 s, 12.9 tokens/s

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

> Нет записей в хранилище, отвечающих на этот вопрос. Вы записали что-то о режиме сна?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 2.0 s, total 5.5 s, search 0.0 s, 7.1 tokens/s

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

> Ingen informasjon om norske kurs finnes i notatene dine. Har du skrevet ned noe om en slik tur til Hemsedal?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 2.6 s, total 7.5 s, search 0.0 s, 6.4 tokens/s

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

> Нет записей, отвечающих на этот вопрос.

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 2.1 s, total 3.1 s, search 0.0 s, 10.2 tokens/s

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

> Нет записей в хранилище, отвечающих на этот вопрос. Есть ли у вас заметки о текущих пропорциях корма для вашей закваски?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 2.0 s, total 10.7 s, search 0.0 s, 3.9 tokens/s

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

> Нет заметок в хранилище, соответствующих этому вопросу. Есть ли у вас записи о каких-либо запланированных забегах?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.2 s, total 9.7 s, search 0.0 s, 4.5 tokens/s

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

> No notes in the vault matched this question.

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.4 s, total 4.8 s, search 0.0 s, 7.5 tokens/s

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

> No notes in the vault matched this question.

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.6 s, total 4.8 s, search 0.0 s, 8.3 tokens/s

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

> No notes match this question.

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.5 s, total 4.4 s, search 0.0 s, 8.5 tokens/s

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
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 3.62)
- 2026-09-28 — v0.9: Widget crash fixed › 2026-09-28 — v0.9: Widget crash fixed (`Projects/Lark/Lark log/2026-09-28 — v0.9.md`, score 2.48)

**Answer:**

> The most requested feature from beta testers is weekly goals, specifically "three times a week" rather than daily (Projects/Lark/Lark log/2026-09-28 — v0.9: Widget crash fixed). Have you documented the specific details of that request in [[Beta feedback]]?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — ignored named note

**Timings:** TTFT 5.3 s, total 16.3 s, search 0.0 s, 6.1 tokens/s

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
- Lark log › Lark log (`Projects/Lark/Lark log.md`, score 2.46)

**Answer:**

> В [[Lark plan]] указаны решения, но нет информации о том, какая платформа первая.
> 
> Что еще вы записали про планы Lark?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — ignored named note

**Timings:** TTFT 3.7 s, total 9.4 s, search 0.0 s, 5.5 tokens/s

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

> You used a 1:1:1 ratio for your old sourdough starter, feeding twice a day with only white flour (Recipes/Sourdough starter (old).md › Sourdough starter (old)).
> 
> Did the previous routine ever peak in three hours?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 9.3 s, total 16.6 s, search 0.0 s, 7.5 tokens/s

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
- Sourdough starter (old) › Sourdough starter (old) (`Recipes/Sourdough starter (old).md`, score 2.67)
- 2026-09-12 — v0.3: Notifications › 2026-09-12 — v0.3: Notifications (`Projects/Lark/Lark log/2026-09-12 — v0.3.md`, score 2.48)
- Sourdough starter › Sourdough starter (`Recipes/Sourdough starter.md`, score 2.29)
- Lark plan › Notifications (`Projects/Lark/Lark plan.md`, score 2.50)

**Answer:**

> You aimed for four hours of deep work a day (Deep Work/Deep Work.md). Have you considered trying the 30-day social media quit mentioned in your notes?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 8.7 s, total 14.7 s, search 0.0 s, 6.3 tokens/s

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
- Bike maintenance manual › Saddle and bars (`Long/Bike maintenance manual.md`, score 2.83)
- Bike maintenance manual › Pedals (`Long/Bike maintenance manual.md`, score 2.83)

**Answer:**

> I don't have any notes regarding Lark notifications. Have you written anything else about notification limits?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 7.5 s, total 10.9 s, search 0.0 s, 6.1 tokens/s

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

> Вы ели хинкали в «Зодиаке», хачапури по-аджарски в «Сакхачапуре №1» и пробовали вино в баре «Вино Андеграунд» (Тбилиси.md › Тбилиси). Вы также отмечали, что обязательно нужно посетить канатку к крепости Нарикала (Тбилиси.md › Тбилиси).

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 4.6 s, total 16.5 s, search 0.0 s, 7.6 tokens/s

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
- none

**Answer:**

> No notes in the vault matched this question.

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.0 s, total 4.2 s, search 0.0 s, 8.6 tokens/s

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

> No notes in the vault matched this question.

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.0 s, total 4.1 s, search 0.0 s, 9.1 tokens/s

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

> Нет записей о том, что нового в Lark с понедельника. Может быть, вы хотели спросить о чем-то другом, что вы записывали?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.1 s, total 9.2 s, search 0.0 s, 5.5 tokens/s

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

> No notes in the vault matched this question.

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.1 s, total 4.2 s, search 0.0 s, 9.0 tokens/s

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

> No notes were found regarding completed Lark tasks. Did you write down any specific projects associated with those tasks?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.1 s, total 7.2 s, search 0.0 s, 5.3 tokens/s

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

> В хранилище нет заметок по этому вопросу. Вы упоминали что-то о "задачах" ранее?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 3.2 s, total 9.0 s, search 0.0 s, 4.8 tokens/s

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

> No notes in the vault matched this question.

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 3.1 s, total 4.1 s, search 0.0 s, 9.4 tokens/s

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

> No notes in the vault matched this question.

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 3.1 s, total 4.3 s, search 0.0 s, 8.5 tokens/s

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

> В заметках нет информации о решении насчет подписки на Netflix (Идеи по монетизации Lark).
> 
> Вы упоминали в заметке об идеях монетизации Lark, что решили отказаться от подписок и рекламы (Идеи по монетизации Lark). Это относится к Lark?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 4.0 s, total 15.5 s, search 0.0 s, 5.9 tokens/s

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

> How can I help you access your notes?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 2.5 s, total 4.1 s, search 0.0 s, 6.3 tokens/s

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

> Что именно вам помогло?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.1 s, total 4.6 s, search 0.0 s, 4.5 tokens/s

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

> Is there anything else I can help you find within your notes?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.0 s, total 4.9 s, search 0.0 s, 7.5 tokens/s

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

> I am Recto, the keeper of this vault.

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct false, honest —, language ok — unneeded retrieval

**Timings:** TTFT 4.4 s, total 5.9 s, search 0.0 s, 8.0 tokens/s

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

> Нет заметок в хранилище, отвечающих на этот вопрос.

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 2.9 s, total 6.1 s, search 0.0 s, 4.8 tokens/s

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

> No notes in the vault matched this question.

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 3.2 s, total 4.3 s, search 0.0 s, 8.5 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
