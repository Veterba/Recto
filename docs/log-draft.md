## 2026-09-25 — topics instead of auto-links, named in the vault's own words

Pairwise auto-links are gone. The machine now groups notes into **topics** and writes one property,
`topics: ["[[topics/Processor · memory]]"]`, at most two per note. The `topics/` prefix never shows in
the app. The `related` links the old feature wrote were taken out once, as a single undoable run.
Linking one note to another is back to being the user's job.

**How a topic is made.** Chunk vectors are centred on the vault's mean chunk, and each note becomes
one vector (at most 48 evenly spaced chunks, so a 500-chunk log is one note, not 500 votes). The
mean is taken over those same capped chunks. At first it wasn't, and the 46k-word Recto log was most
of the mean. Average-linkage clustering cuts at T_TOPIC, and clusters of three or more become topics.
Later notes are placed against cached centroids and never rebuilt. A rebuild keeps a topic's id and
name when the members overlap by half. Removing a topic from a note blocks it there for good, and
Settings → Topics can rename or delete one.

**Dev builds never touch real notes.** A forgotten `electron-vite dev` session had been running
unfinished code against the real vault. Now a dev build keeps its own app data ("Recto (dev)"), opens
a copy of whatever vault it's pointed at unless `RECTO_ALLOW_REAL_VAULT=1`, and opening Settings in
dev never lifts the first-write gate. Renaming a topic used to rewrite plain `[[Name]]` links to
real notes. It now matches `[[topics/Name]]` exactly, and a regression test holds it there.

**Names were the weak part.** "Code · dir", "Изучить · попробовать", "Строки · возвращает". Naming
is rebuilt:

1. Prose only. Code blocks, inline code, URLs, file paths, frontmatter and link targets are stripped
   first.
2. Nouns only, in base form. Russian goes through Az.js (OpenCorpora dictionary, 11 MB, MIT, offline).
   English goes through compromise, which the editor already ships. Verbs never get a say, and a
   stopword list catches the filler ("задача", "plan", "try").
3. A noun in more than half the vault's notes names nothing in particular and is dropped.
4. A noun must be used by **most of the topic's notes**. This rule does the real work: a genre
   cluster (plans, to-do lists) has no noun most of its notes share, so it has no name, and a
   cluster with no two candidates is not a topic.
5. c-TF-IDF picks 15 candidates, and EmbeddingGemma picks the two closest to the centroid.

**One language per vault.** Each note's language is read from its script and stopwords. The vault
language is whatever most eligible notes are in, and it switches only when another language leads by
5 notes. A switch renames every machine-named topic, or removes one with no name in the new
language, in one run that one Undo reverts. After an undo, that switch isn't made again by itself.
Topics renamed by hand are never touched. There's no Latin in a Russian vault's names and no Cyrillic
in an English one. Norwegian has no lemmatizer this small, so a Norwegian vault gets no names yet.

**What didn't work: all-but-the-top.** Removing the top one or two principal components was
supposed to take out genre. On this vault it made things clearly worse: pair precision fell from
1.00 to 0.67 (one component) and 0.33 (two). On the Obsidian copy it was flat or noisy. So it is
not in.

**The cut is precision first.** The fallback is now the 95th percentile of pair similarity, taken
over every pair in a vault this size rather than 500 sampled ones. Settings says "Works best from
about 50 notes. You have N." while there are fewer.

| | this vault | Obsidian copy |
|---|---|---|
| language (eligible notes) | English (25 en, 7 ru) | Russian (34 ru, 3 en) |
| T_TOPIC | 0.340 | 0.313 |
| topics | Cabinet · sqlite (5), Plugin · load (3) | Строка · метод (4), Процессор · регистр (3) |
| notes with a topic | 8 of 32 (25%) | 7 of 37 (19%) |
| second run | 0 files touched | 0 files touched |

Coverage is low, and that's on purpose: a missing topic is fine, a wrong one is not. The math units
in this vault are Russian notes in an English vault, so they get no topic. "Строка · метод" mixes JS
and Python string methods, which is arguably a subject and arguably a genre. "Plugin · load" is a
weak name.

683 tests, typecheck and build clean, plus the end-to-end test.

## 2026-09-25 — topics: no global cut, names across languages, the user's removals decide

**The cut was a density assumption.** p95 of pair similarity assumes same-topic pairs are rare. On
the fixture (6 subjects × 4 notes, so 13% of pairs are same-subject) it found 1 topic. Silhouette
over all notes picked blobs on the real vaults, and so did a gap in the merge heights. What works is
judging each cluster on its own. First, excess of mass over the average-linkage tree: a cluster is
kept if it holds together longer than its sub-clusters do. Then a cluster must reach a mean
silhouette ≥ 0.25, or it's set aside and its sub-clusters compete again. That second step removes
"two tight groups joined at a low similarity" (SQL + memory notes, a Docker/Git/HTTP mix). Neither
step assumes a density: every fixture subset from 2 to 6 subjects comes out exact.

**No topic dropped for its language.** Clustering is by meaning only. A cluster written in another
language than the vault takes its noun candidates in its own language and translates them offline.
The tables come from Wiktionary via kaikki.org (CC BY-SA, 0.84 MB for ru→en, nb→en and a Bokmål
form→lemma table); en→ru/nb is the same data inverted. Each candidate's translation is the one
closest to the centroid. It must clear a floor of 0.05, which is low because a word in another
language sits about 0.1 lower against the notes. It must also be within 0.8 of the word it
translates, so a wrong sense of the word doesn't pass. Proper names aren't translated: "Rust" isn't
"ржа". The Russian math units in this English vault became **Equation · formula**.

**The user's removals are the granularity setting.** Removing a topic from a note (×) is permanent
there. If the user removes it from more than half its notes, the topic is dissolved and never made
again from those notes. This is tracked apart from Undo's own blocks, or undoing a first run would
dissolve everything. No Undo brings any of it back.

**Tests don't read the vault.** The labelled sets are now in the repo, but as opaque positions,
subjects and similarity matrices, with no text or vectors. The repo is public. Pairs that are one
concept in two languages (string methods in JS vs Python) are marked ambiguous and left out: 41 in
the Obsidian copy.

| | fixture | this vault | Obsidian copy |
|---|---|---|---|
| language | en 24 | en 25, ru 7 | ru 34, en 3 |
| topics | 5 (6 clusters; Money gets no name) | Cabinet · editor 6, Equation · formula 4 *(from ru)*, Plugin · load 3 | Строка · метод 4, Процессор · память 4 |
| notes with a topic | 20/24 | 13/32 | 8/37 |
| pairs P / R | 1.00 / 0.83 | 1.00 / 0.13 | 1.00 / 0.21 |
| topics P / R | 5/5, 5/6 | 3/3, 2/2 | 2/2, 2/4 |
| second run | 0 files touched | 0 | 0 |

A second run first made a new topic from the leftover notes: finding topics over the pool alone
judged clusters against other neighbours. It now selects over all notes and only turns a cluster made
entirely of leftover notes into a topic, so an unchanged vault gives the same result.

Packaged `.app` verified: Az.js from inside the asar, the tables from Resources, and a full run on a
vault copy all give the same topics. 693 tests.

**Caveat on the 0.25.** The silhouette bar (and the 0.05 lifetime) were chosen on the same three
datasets they were then checked on: the fixture, this vault and the Obsidian copy. That makes the
precision numbers above optimistic. They need a held-out check: once this vault has 50+ eligible
notes, re-label it (or a slice of new notes) without looking at the topics first, and measure
again. The same goes for the translation floor (0.05) and the same-meaning bar (0.8).

The fixture's quality test now runs in plain `npm test`: EmbeddingGemma's vectors for its chunks and
candidate words are recorded in `test/fixtures/topics-vault-vectors.json` (synthetic text) and
replayed through the whole pipeline: 6 subjects → 6 pure topics, 5 named, Money unnamed. The
live-model version still runs with `RECTO_MODEL_DIR` set; `RECTO_RECORD_FIXTURE=1` re-records.
