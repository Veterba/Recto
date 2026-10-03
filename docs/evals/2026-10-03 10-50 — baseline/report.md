---
run_id: "2026-10-03 10-50 — baseline"
date: 2026-10-03T08:50:32.677Z
model: gemma4:12b
commit: b02b0ea (dirty)
report_version: 1
compared_to: none
---

# Recto Eval: baseline

## Summary

First run of this kind: gemma4:12b on the fixture vault, labelled "baseline". 15 of 33 cases pass (45%), recall@4 29%, time to first token 7.0 s at the median (p90 25.7 s), 4.6 tokens/s. Nothing to compare with yet, so this is the baseline later runs are measured against.

## Setup

- Model: gemma4:12b, via Ollama 0.31.1; one model loaded: other models unloaded before the run (were: qwen3.5:9b)
- Speed check before the run: 10.1 tokens/s (a throttling Mac shows under 5)
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
- **TTFT** p50 7.0 s, p90 25.7 s — from the question to the first token, including the vault search.
- **total time** p50 15.5 s, p90 36.4 s — from the question to the last token.
- **tokens/sec**: 4.6. Answer tokens over generation time, as Ollama reports them, averaged over cases.
- **peak memory**: Ollama 9.4 GB resident, the model 1.0 GB by Ollama's count, the app 0.4 GB; swap used 6.1 GB before → 6.6 GB after.
- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.

## Results

| Kind | Cases | Pass | recall@4 | Named in answer | Sources correct | Honest |
|---|---|---|---|---|---|---|
| same-language | 6 | 4/6 (67%) | 67% | 83% | 67% | — |
| cross-language | 6 | 0/6 (0%) | 0% | 0% | 0% | — |
| named-note | 4 | 2/4 (50%) | 50% | 75% | 50% | — |
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
| same-language | 6.6 s | 16.3 s | 15.3 s | 28.8 s | 5.2 |
| cross-language | 4.8 s | 5.6 s | 12.2 s | 14.8 s | 4.9 |
| named-note | 8.9 s | 17.5 s | 18.5 s | 26.7 s | 5.0 |
| follow-up | 8.7 s | 15.8 s | 21.6 s | 23.6 s | 4.7 |
| recent | 24.6 s | 31.8 s | 36.4 s | 41.0 s | 3.4 |
| tasks | 30.6 s | 31.1 s | 38.3 s | 40.6 s | 3.9 |
| not-in-vault | 21.6 s | 23.8 s | 30.6 s | 32.3 s | 4.9 |
| small-talk | 5.9 s | 6.3 s | 11.7 s | 14.1 s | 4.3 |
| self | 6.2 s | 7.7 s | 13.2 s | 15.5 s | 4.3 |
| **overall** | 7.0 s | 25.7 s | 15.5 s | 36.4 s | 4.6 |

## Error analysis

- `named-beta-feedback` (named-note) — ignored named note: expected Beta feedback; read Localise into Norwegian, Lark log, 2026-09-28 — v0.9
- `named-ru-plan-platform` (named-note) — ignored named note: expected Lark plan; read Lark log
- `recent-wednesday` (recent) — retrieval miss: expected 2026-09-23 — v0.7; read nothing
- `tasks-open-last-week` (tasks) — retrieval miss: expected App Store screenshots, Localise into Norwegian, VoiceOver labels; read nothing
- `tasks-ru-overdue` (tasks) — retrieval miss: expected Write privacy policy; read nothing

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

> Your current routine (since September 2026) uses a 1:5:5 ratio: 10 g starter, 50 g flour, and 50 g water [Sourdough starter].
> 
> You previously used a 1:1:1 ratio in your old routine [Sourdough starter (old)].
> 
> Do you need the specific measurements for the flour types used in the current routine?

**Expected:** notes Sourdough starter; answer 1:5:5 once a day (10 g starter, 50 g flour, 50 g water) - not the old 1:1:1.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 16.3 s, total 28.8 s, search 0.0 s, 7.0 tokens/s

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

> Your half marathon is on 8 November 2026, and you are aiming to finish under 1:50 (Running plan).
> 
> Do you have a specific pace target for your Sunday long runs?

**Expected:** notes Running plan; answer Oslo half marathon on 8 November 2026, under 1:50.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 6.6 s, total 15.3 s, search 0.0 s, 5.1 tokens/s

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

> The wear limit for an 11-speed chain is 0.5% elongation (Bike maintenance manual (Long/Bike maintenance manual.md › Chain)).
> 
> Have you checked your current mileage to see if it's time for a measurement?

**Expected:** notes Bike maintenance manual; answer 0.5% elongation (0.75% for 8- and 9-speed).

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 10.9 s, total 20.5 s, search 0.0 s, 5.5 tokens/s

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

> Вам нужно накопить 540 000 рублей (Подушка безопасности).
> 
> На данный момент у вас уже есть 310 000 рублей (Подушка безопасности).
> 
> Хотите рассчитать, сколько еще осталось собрать?

**Expected:** notes Подушка безопасности; answer 540 000 рублей (6 месяцев расходов по 90 000), сейчас 310 000.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 7.0 s, total 19.0 s, search 0.0 s, 4.6 tokens/s

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

> В хранилище нет информации о том, во сколько вам лучше ложиться спать.
> 
> Есть ли у вас записи о вашем режиме дня или предпочтениях в сне?

**Expected:** notes Сон; answer До 23:30, вставать в 7:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.4 s, total 12.7 s, search 0.0 s, 5.1 tokens/s

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

> Vaultet inneholder ingen informasjon om når du har norskkurs.
> 
> Har du notert dette i en annen mappe?

**Expected:** notes Norskkurs; answer Tirsdag og torsdag kl. 18.00–20.00.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 6.4 s, total 12.7 s, search 0.0 s, 3.9 tokens/s

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

> В хранилище нет записей о ваших решениях касательно уведомлений в Lark.
> 
> Вы уже принимали какие-то другие решения по настройкам рабочих инструментов?

**Expected:** notes Lark plan; answer Не больше двух напоминаний в день и никогда после 21:00.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.7 s, total 13.1 s, search 0.0 s, 4.2 tokens/s

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

> В хранилище нет записей о текущем соотношении при кормлении закваски.
> 
> Вы записывали что-то подобное ранее?

**Expected:** notes Sourdough starter; answer 1:5:5 раз в день.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.8 s, total 10.0 s, search 0.0 s, 6.0 tokens/s

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

> В хранилище нет информации о дате вашего полумарафона.
> 
> Вы планировали записать дату забега в какие-то конкретные заметки?

**Expected:** notes Running plan; answer 8 ноября 2026, в Осло.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.5 s, total 14.2 s, search 0.0 s, 3.8 tokens/s

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

> I'm sorry, but the vault doesn't contain any information regarding baking time for beets in a borscht recipe.
> 
> Would you like me to look for other notes related to your cooking recipes?

**Expected:** notes Борщ; answer 40 minutes in foil at 200 °C.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.6 s, total 14.8 s, search 0.0 s, 4.6 tokens/s

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

> The vault does not contain any information regarding a kitchen renovation or its budget.
> 
> Would you like me to search for specific keywords related to home improvements?

**Expected:** notes Ремонт кухни; answer Igor's crew of three, 450,000 roubles, starting 3 November.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.2 s, total 12.2 s, search 0.0 s, 4.4 tokens/s

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

> The vault does not contain any information regarding how you decided to make money with Lark.
> 
> Is there a specific project or note about Lark you would like me to look for?

**Expected:** notes Идеи по монетизации, Lark plan; answer No subscriptions or ads; a one-time €12 purchase for themes and widget styles.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 4.8 s, total 10.2 s, search 0.0 s, 6.7 tokens/s

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

> Testers most frequently request weekly goals, specifically "three times a week" instead of daily (2026-09-28 — v0.9: Widget crash fixed).
> 
> Would you like to see the specific monetization thoughts related to these features?

**Expected:** notes Beta feedback; answer Weekly goals (7 of 12 testers).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — ignored named note

**Timings:** TTFT 8.9 s, total 18.5 s, search 0.0 s, 5.7 tokens/s

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

> В предоставленных заметках нет информации о том, какая платформа является первой.
> 
> Вам нужно открыть заметку [[Lark plan]], чтобы узнать эти детали?

**Expected:** notes Lark plan; answer iOS, на SwiftUI; Android только после 1.0.

**Scores:** recall@4 0%, named in answer true, sources correct false, honest —, language ok — ignored named note

**Timings:** TTFT 6.1 s, total 14.5 s, search 0.0 s, 3.9 tokens/s

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

> You used a 1:1:1 ratio of 50 g starter, 50 g flour, and 50 g water (Sourdough starter (old)).
> 
> Do you want to see the current routine for comparison?

**Expected:** notes Sourdough starter (old); answer 1:1:1, fed twice a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 17.5 s, total 26.7 s, search 0.0 s, 5.4 tokens/s

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

> You aim for four hours of deep work a day; more is rarely possible (Deep Work).
> 
> Do you have any specific blocks scheduled for this today?

**Expected:** notes Deep Work; answer Four hours a day.

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 15.0 s, total 21.5 s, search 0.0 s, 4.9 tokens/s

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

> The vault does not contain any notes regarding Lark notifications or their specific settings.
> 
> Would you like me to look for other software-related notes?

**Expected:** notes Lark plan; answer In Lark plan, under Notifications.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — wrong note

**Timings:** TTFT 15.8 s, total 23.6 s, search 0.0 s, 3.8 tokens/s

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

> Вы ели хинкали в «Зодиаке», хачапури по-аджарски в «Сакхачапуре №1» и пили вино в баре «Вино Андеграунд» (Тбилиси).
> 
> Планируете ли вы повторить какой-то из этих маршрутов?

**Expected:** notes Тбилиси; answer Хинкали в «Зодиаке», хачапури в «Сакхачапуре №1», вино в «Вино Андеграунд».

**Scores:** recall@4 100%, named in answer true, sources correct true, honest —, language ok

**Timings:** TTFT 8.7 s, total 21.6 s, search 0.0 s, 5.6 tokens/s

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

> The vault does not contain any information regarding what you worked on in Lark last week.
> 
> Would you like me to look for notes related to "Lark" specifically?

**Expected:** notes 2026-09-21 — v0.6, 2026-09-23 — v0.7, 2026-09-25 — v0.8; answer Onboarding redesign, dark mode and VoiceOver, the first TestFlight beta.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 5.3 s, total 14.9 s, search 0.0 s, 3.6 tokens/s

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

> I do not have any information regarding your activities on Wednesday last week.
> 
> Did you happen to record these events in a different folder?

**Expected:** notes 2026-09-23 — v0.7; answer Dark mode palette and VoiceOver labels (v0.7).

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 31.8 s, total 41.0 s, search 0.0 s, 3.0 tokens/s

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

> В хранилище нет информации о том, что нового появилось в Lark с понедельника.
> 
> Есть ли другие темы или проекты из ваших заметок, которые вы хотели бы обсудить?

**Expected:** notes 2026-09-28 — v0.9; answer Исправлен краш виджета на iOS 17, собраны отзывы бета-тестеров, начат текст политики конфиденциальности.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 24.6 s, total 36.4 s, search 0.0 s, 3.4 tokens/s

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

> The vault does not contain any information regarding Lark tasks or their status.
> 
> Do you have a specific note about your Lark projects I should look for?

**Expected:** notes App Store screenshots, Localise into Norwegian, VoiceOver labels; answer Open - App Store screenshots (doing), Localise into Norwegian; done - VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 30.6 s, total 40.6 s, search 0.0 s, 3.1 tokens/s

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

> The vault does not contain any information regarding completed Lark tasks.
> 
> Would you like to add a note about your progress on these tasks?

**Expected:** notes Fix widget crash on iOS 17, VoiceOver labels; answer Fix widget crash on iOS 17, VoiceOver labels.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 25.7 s, total 33.0 s, search 0.0 s, 3.8 tokens/s

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

> В хранилище нет записей о ваших задачах или сроках их выполнения.
> 
> Есть ли у вас список задач в другом месте, который вы хотели бы добавить?

**Expected:** notes Write privacy policy; answer Write privacy policy - срок был 26 сентября.

**Scores:** recall@4 0%, named in answer false, sources correct false, honest —, language ok — retrieval miss

**Timings:** TTFT 31.1 s, total 38.3 s, search 0.0 s, 4.9 tokens/s

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

> I do not have any information regarding the capital of Australia in my notes.
> 
> Is there a specific country or location you would like me to look for in your records?

**Expected:** notes —; answer Says the notes don't cover it.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 21.6 s, total 27.9 s, search 0.0 s, 5.6 tokens/s

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

> The vault does not contain any information regarding a trip to Japan. 
> 
> Did you perhaps store those notes under a different title?

**Expected:** notes —; answer There is no note about a trip to Japan.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 23.8 s, total 30.6 s, search 0.0 s, 3.9 tokens/s

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

> В предоставленных записях нет информации о вашем решении относительно подписки на Netflix.
> 
> Вы планировали отказаться от подписок в контексте монетизации Lark (Идеи по монетизации Lark). Хотите дополнить записи о стриминговых сервисах?

**Expected:** notes —; answer В заметках об этом ничего нет.

**Scores:** recall@4 —, named in answer —, sources correct —, honest true, language ok

**Timings:** TTFT 20.9 s, total 32.3 s, search 0.0 s, 5.2 tokens/s

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

> I am Recto, the keeper of this vault. Please tell me what you would like to know from your notes.

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 4.9 s, total 10.0 s, search 0.0 s, 5.0 tokens/s

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

> Пожалуйста. Есть ли что-то еще в ваших записях, что вы хотели бы обсудить?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 11.7 s, search 0.0 s, 4.0 tokens/s

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

> The vault contains no information regarding "nice" or your reaction to it.
> 
> Is there a specific topic you would like me to look into?

**Expected:** notes — (no sources); answer —

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 6.3 s, total 14.1 s, search 0.0 s, 3.8 tokens/s

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

> I do not have information about my own identity or model type in the vault.
> 
> Would you like me to summarize the Project skeleton instead?

**Expected:** notes — (no sources); answer Names the local model running in Ollama on this computer.

**Scores:** recall@4 —, named in answer —, sources correct false, honest —, language ok — unneeded retrieval

**Timings:** TTFT 7.7 s, total 15.5 s, search 0.0 s, 3.7 tokens/s

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

> В хранилище нет информации о годе моих знаний.
> 
> Есть ли в ваших записях данные о датах или хронологии?

**Expected:** notes — (no sources); answer Не знает точной даты; отвечает по заметкам, а не по своим знаниям.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 6.2 s, total 12.8 s, search 0.0 s, 4.5 tokens/s

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

> The vault does not contain information regarding whether your notes are sent anywhere.
> 
> Do you have a specific note about data privacy or storage that I should look for?

**Expected:** notes — (no sources); answer No - the model runs locally, nothing leaves the computer.

**Scores:** recall@4 —, named in answer —, sources correct true, honest —, language ok

**Timings:** TTFT 5.9 s, total 13.2 s, search 0.0 s, 4.6 tokens/s

**Grade**
- [ ] good
- [ ] bad
- Note:
