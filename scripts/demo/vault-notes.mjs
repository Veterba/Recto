// The demo vault's notes: invented, written the way the vault's owner writes
// (no title heading, an italic "A note about" line, headings from ### down,
// links by name). No real people, no brands. Keyed by folder, then note name.

export const NOTES = {
  Japanese: {
    'Learning Japanese': `*A note about why I'm learning Japanese and how the pieces fit together*

I started properly in January after the second trip. The goal is modest: ==hold a slow conversation in a shop or a guesthouse without switching to English==, and read a short story without looking up every line.

### Where things are

- Scripts: [[Hiragana]], [[Katakana]], [[Kanji study method]]
- Grammar: [[Particles wa and ga]], [[Particles ni and de]], [[Verb groups]], [[Te-form]]
- Speaking: [[Polite and casual speech]], [[Keigo for shops]], [[Shadowing]]
- Habits: [[Spaced repetition routine]], [[Listening practice]], [[Reading graded stories]]

### How it's going

| Skill | Level | Next step |
| --- | --- | --- |
| Reading kana | Comfortable | Speed |
| Kanji | About 220 | Keep to 5 a week |
| Listening | Slow speech only | More [[Shadowing]] |
| Speaking | Rehearsed phrases | [[Trip phrases]] out loud |

Every mistake worth remembering goes in the [[Mistakes log]].
`,
    Hiragana: `*A note about the hiragana I still mix up*

Took about three weeks to learn the whole set. Writing each row by hand helped far more than the charts did.

The pairs that still slow me down:

- ね and れ and わ
- ぬ and め
- さ and ち when they're printed in a rounded font

Reading practice from [[Reading graded stories]] fixed most of it. See [[Katakana]] for the twin problem.
`,
    Katakana: `*A note about katakana and why it took longer than hiragana*

I put this off because it felt like it was only for loanwords. Then I couldn't read a single menu. Menus, signs and packaging are full of it, so it matters a lot for [[Trip phrases]].

- シ and ツ: stroke direction is the only clue
- ソ and ン: same problem
- Long vowels use ー, which I kept reading as a dash

A trick that worked: read café menus out loud and guess the English word. Pairs well with [[Hiragana]].
`,
    'Kanji study method': `*A note about how I learn kanji without burning out*

Five new kanji a week, no more. I tried twenty once and forgot them all within a month, which is exactly what the [[Forgetting curve]] predicts.

For each one:

1. Learn it inside a word I already know, never alone
2. Look at the parts, see [[Radicals I keep forgetting]]
3. Write it three times, then add it to the [[Spaced repetition routine]]

Reviews happen in the evening, because of what I read in [[Memory consolidation]]. It may be a placebo. I don't care.
`,
    'Radicals I keep forgetting': `*A note about the kanji parts that don't stick*

| Radical | Meaning | Shows up in |
| --- | --- | --- |
| 氵 | water | 海, 池, 洗 |
| 忄 | heart | 忙, 性 |
| 糸 | thread | 紙, 線 |
| 言 | words | 語, 話, 読 |

Once I know the part, the whole character stops being a picture. Linked from [[Kanji study method]].
`,
    'Particles wa and ga': `*A note about は and が, which I will never fully understand*

The short version my teacher gave me: は sets the topic, が points at the thing.

- 猫は寝ている: as for the cat, it's sleeping
- 猫が寝ている: look, a cat is sleeping

==If the sentence answers "who?", it's almost always が.== That one rule fixed most of my errors in the [[Mistakes log]].

Related: [[Particles ni and de]].
`,
    'Particles ni and de': `*A note about に and で for places*

に is where something exists or where you're heading. で is where an action happens.

- 公園にいる: I'm at the park
- 公園で走る: I run in the park

I kept writing 公園に走る. Writing out ten sentences a day for a week fixed it. Next up is [[Verb groups]], since the verb decides which one you need.
`,
    'Verb groups': `*A note about the three verb groups*

- Group 1: ending in u, like 書く and 話す
- Group 2: ending in iru or eru, like 食べる
- Group 3: する and くる, the two rebels

The trap is words that look like group 2 but aren't: 帰る, 走る, 切る. These are all in the [[Mistakes log]] at least once. The group decides how the [[Te-form]] is built.
`,
    'Te-form': `*A note about the te-form, the most useful thing I've learned so far*

Once this clicked, half of the grammar opened up: requests, ongoing actions, linking sentences.

| Ending | Becomes | Example |
| --- | --- | --- |
| く | いて | 書いて |
| ぐ | いで | 泳いで |
| む, ぶ, ぬ | んで | 読んで |
| う, つ, る | って | 待って |
| す | して | 話して |

I sing it to a tune, which is embarrassing but works. Depends on [[Verb groups]]; used constantly in [[Polite and casual speech]].
`,
    'Polite and casual speech': `*A note about when to use which level*

Stick to です and ます with anyone I don't know. Casual forms are for friends, and only after they've used them first.

My conversation partner pointed out that I sound like a textbook, and that's fine. Sounding too polite is a smaller mistake than sounding rude.

For shops and hotels, see [[Keigo for shops]]. The [[Te-form]] does most of the softening: 待ってください.
`,
    Counters: `*A note about counters, which are ridiculous*

Different words for counting different shapes of things. I only learn the ones I'd really use:

- 人 people
- 枚 flat things, like tickets
- 本 long things, like bottles
- 個 small round things, and a safe default
- 杯 cups and glasses

Good enough for ordering, see [[Trip phrases]].
`,
    'Keigo for shops': `*A note about the formal language shop staff use on me*

I don't need to produce this, but I do need to recognise it. It's why the first trip was so confusing.

- いらっしゃいませ: welcome, no answer needed
- 少々お待ちください: please wait a moment
- ポイントカードはお持ちですか: do you have a points card?

That last one caught me every single time. Answer with いいえ, and move on. Part of [[Polite and casual speech]].
`,
    'Listening practice': `*A note about what I listen to and for how long*

Twenty minutes a day, mostly slow podcasts for learners, on the walk to work. I listen to each episode twice: once for the gist, once with the transcript.

Oddly, I remember more when I listen in the evening and don't study anything else after it. That lines up with [[Interference and sleep]], and a short nap seems to help too, see [[Naps and learning]].

Active listening goes in [[Shadowing]].
`,
    Shadowing: `*A note about shadowing, which feels silly and works*

Play a sentence and repeat it half a second behind the speaker. Don't read. Don't translate.

1. Choose a clip of about a minute
2. Listen three times
3. Shadow with the transcript
4. Shadow without it

Five minutes is plenty. My pitch has improved more from this than from anything else in [[Listening practice]].
`,
    'Reading graded stories': `*A note about reading simple stories for pleasure*

Level one stories felt childish for about a week, then suddenly felt like reading. The aim is 95% known words, so I can guess the rest instead of stopping.

Currently on a folk tale about a fox and a tea kettle. New words go straight into the [[Spaced repetition routine]].
`,
    'Spaced repetition routine': `*A note about my daily flashcard routine*

Fifteen minutes after dinner. Never more than twenty new cards in a week.

The schedule is a practical answer to the [[Forgetting curve]]: review just before you'd forget. I keep the session before bed because of [[Memory consolidation]], though I can't prove it helps me.

### Rules I settled on

- A card is a sentence, not a lone word
- Delete cards I hate
- Never catch up on more than two days of backlog at once

Fed by [[Kanji study method]] and [[Reading graded stories]].
`,
    'Mistakes log': `*A note about mistakes worth remembering*

| Date | I said | Should be | Why |
| --- | --- | --- | --- |
| 2026-09-02 | 公園に走る | 公園で走る | [[Particles ni and de]] |
| 2026-09-18 | 帰べます | 帰ります | [[Verb groups]] |
| 2026-10-05 | 誰は来た | 誰が来た | [[Particles wa and ga]] |
| 2026-10-21 | 読むて | 読んで | [[Te-form]] |

Rereading this once a month is more useful than I expected.
`,
    'Trip phrases': `*A note about phrases to have ready for the spring trip*

### Food

- これをください: this one, please
- おすすめは何ですか: what do you recommend?
- お会計をお願いします: the bill, please

### Getting around

- 駅はどこですか: where is the station?
- この電車は止まりますか: does this train stop there?

Practise with [[Shadowing]], and don't forget [[Counters]] for ordering.
`,
  },

  Kitchen: {
    'Kitchen renovation': `*A note about the kitchen project: what we're doing and why*

The old kitchen has one socket near the worktop, doors that don't close and a floor that slopes toward the sink. We've saved for two years. ==Work starts in January, and the goal is to be cooking in it again by March.==

### Plan

- Layout: [[Floor plan]], [[Pantry wall]]
- Storage: [[Cabinets]], [[Drawer layout]]
- Surfaces: [[Worktop materials]], [[Splash-back tiles]], [[Flooring]], [[Paint colours]]
- Services: [[Electrics]], [[Plumbing notes]], [[Ventilation]], [[Lighting plan]]
- Money: [[Budget]], [[Appliance list]]

![[kitchen-floor-plan.png]]

Questions for the builder live in [[Contractor questions]].
`,
    Budget: `*A note about what the kitchen will cost*

| Item | Estimate | Quote | Note |
| --- | --- | --- | --- |
| Cabinets | 6,500 | 7,120 | [[Cabinets]] |
| Worktop | 1,800 | 2,050 | [[Worktop materials]] |
| Appliances | 3,200 | 3,040 | [[Appliance list]] |
| Electrics | 900 | 1,150 | [[Electrics]] |
| Plumbing | 700 | 640 | [[Plumbing notes]] |
| Flooring | 1,100 | 1,090 | [[Flooring]] |
| Tiles and paint | 500 | 480 | [[Splash-back tiles]] |

==Keep 10% aside for what we find behind the walls.== Something is always behind the walls.
`,
    'Floor plan': `*A note about the new layout*

We're moving the sink under the window and turning the old door into a [[Pantry wall]]. The distance between sink, hob and fridge drops from about seven metres to under five.

- Keep 110 cm between the island and the units
- The fridge door must open fully past the wall
- Check the radiator position, see [[Plumbing notes]]

![[kitchen-floor-plan.png]]

Everything else follows from this: [[Cabinets]], [[Electrics]], [[Lighting plan]].
`,
    Cabinets: `*A note about cabinet choices*

Painted doors, plain frame, no handles on the tall units. Two workshops have quoted so far. The local joiner costs more, but the carcasses are solid board instead of chipboard.

- Full-height doors on the [[Pantry wall]]
- Drawers instead of doors below the worktop, see [[Drawer layout]]
- Colour to be decided with [[Paint colours]]

Quote figures are in the [[Budget]].
`,
    'Drawer layout': `*A note about what goes in which drawer*

I timed myself making dinner and wrote down what I reached for. Boring, but it worked.

| Drawer | Contents | Near |
| --- | --- | --- |
| Top left | Knives, spoons, spatulas | Hob |
| Deep left | Pans and lids | Hob |
| Top right | Cutlery | Dishwasher |
| Deep right | Plates and bowls | Dishwasher |
| Narrow | Oils and spices | Hob |

Drawer sizes go to the joiner along with [[Cabinets]].
`,
    'Worktop materials': `*A note about worktop options*

| Material | Good | Bad |
| --- | --- | --- |
| Oak | Warm, can be sanded | Needs oiling, hates water by the sink |
| Quartz | Tough, no sealing | Expensive, joints show |
| Stainless | Lasts forever | Scratches, feels like a canteen |
| Laminate | Cheap | Edges swell with water |

Leaning toward quartz by the sink and an oak section on the island. Samples are on the [[Renovation]] board. Goes with [[Splash-back tiles]].
`,
    'Splash-back tiles': `*A note about the tiles behind the hob*

Handmade-look glazed tiles in a warm white, stacked vertically. They cost more than plain ones, but the area is small: just under 3 square metres with 10% spare.

![[tile-samples.png]]

The grout should be a shade darker than the tile, or it will just look dirty in a year. Compare with [[Paint colours]] in daylight.
`,
    'Lighting plan': `*A note about the kitchen lights*

Three layers, each on its own switch:

- Ceiling spots for cleaning and evenings with guests
- Strip lights under the wall units for cooking
- A low pendant over the island for everything else

Warm white everywhere, 2700 K. Mixing colour temperatures is why the old kitchen looked sick. Wiring runs are in [[Electrics]]; layout depends on [[Floor plan]].

Evening light also matters for sleep, so the pendant goes on a dimmer. See [[Caffeine timing]] for the other thing I keep ignoring.
`,
    'Sink and tap': `*A note about the sink and tap*

Single deep bowl, undermounted. A double bowl wastes width, and I've never once used both halves.

Tap: tall spout, single lever, pull-out spray. I need to check the worktop thickness and the cut-out with [[Worktop materials]]. Pipe positions are in [[Plumbing notes]].
`,
    'Appliance list': `*A note about what we're buying and what we're keeping*

| Appliance | Plan | Width |
| --- | --- | --- |
| Hob | New, induction, 4 zones | 60 cm |
| Oven | New, single | 60 cm |
| Fridge | Keep | 70 cm |
| Dishwasher | New, quiet model | 60 cm |
| Extractor | New, see [[Ventilation]] | 80 cm |

Induction needs its own circuit, see [[Electrics]]. Totals are in the [[Budget]].
`,
    Ventilation: `*A note about getting rid of cooking smells*

A recirculating hood only filters. A ducted one actually takes the air outside, so we're ducting through the back wall. It's 2.4 m to the outside: short enough, with only one bend.

- Keep the duct as straight as possible
- 150 mm rigid pipe, not flexible hose
- Ask about the wall core drill, see [[Contractor questions]]
`,
    Flooring: `*A note about the floor*

The slope has to be fixed first. The builder wants to lay a levelling screed, then we can choose.

Large-format porcelain is easy to clean and fine with underfloor heating. Cold on the feet without it. Warm wood-look vinyl is the budget fallback.

The floor must go in before [[Cabinets]], and the level has to match the hall. Noted in [[Contractor questions]].
`,
    Electrics: `*A note about sockets and circuits*

- Dedicated circuit for the hob and the oven
- Eight double sockets, four of them on the island side
- Under-cabinet lighting feed from the switch by the door
- Two USB sockets near the window

First fix happens after the walls are stripped. The drawing must match the [[Lighting plan]] and the [[Appliance list]].
`,
    'Plumbing notes': `*A note about moving the water and waste*

Moving the sink under the window means a new waste run of about 3 metres, with enough fall to the outside wall. The plumber says it's fine if we go through the cupboard behind the [[Pantry wall]].

The radiator has to move too. Possibly replace it with a plinth heater, see [[Floor plan]].

Also connect the dishwasher on the sink side, see [[Sink and tap]].
`,
    'Contractor questions': `*A note about what to ask the builder before we sign*

| Task | Status | Due |
| --- | --- | --- |
| Is the wall by the door load-bearing? | Done | 2026-10-14 |
| Who removes the old units? | Done | 2026-10-20 |
| Levelling screed drying time | Doing | 2026-11-10 |
| Core drill for [[Ventilation]] | To do | 2026-11-14 |
| Dust protection for the hall | To do | 2026-11-20 |

Keep everything in writing. Payment stages go next to the [[Budget]].
`,
    'Pantry wall': `*A note about turning the old door into storage*

Blocking the second doorway gives us 2.4 metres of wall for floor-to-ceiling cupboards. It's the single best idea in the whole project and it cost nothing to think of.

- Shallow shelves, 30 cm deep, so nothing gets lost at the back
- One tall section for the vacuum and the ironing board
- A small sensor light inside

Measurements are on the [[Renovation]] board. It affects [[Floor plan]] and [[Plumbing notes]].
`,
    'Paint colours': `*A note about wall and cabinet colours*

Tried four samples on the wall. The room faces north, so anything cool goes grey by the afternoon.

- Walls: warm off-white, matt, washable
- Cabinets: muted green, or dark blue-grey if we're brave
- Ceiling: plain white

The winner will have to live with the [[Splash-back tiles]], so I'm checking them side by side at 4 pm.
`,
  },

  'Sleep and memory': {
    'Sleep and memory': `*A note about my reading project on what sleep does for memory*

This started as a question from my language study: does when I sleep change what I remember? It grew into a small literature review of my own. I'm not a scientist, so everything here is my reading, not advice.

### Main threads

- The basics: [[Sleep stages]], [[Memory consolidation]]
- Mechanisms: [[Slow-wave sleep]], [[Sleep spindles]], [[REM and emotional memory]]
- Experiments: [[Targeted memory reactivation]], [[Naps and learning]], [[Sleep deprivation effects]]
- My own notes: [[Reading log]], [[Open questions]], [[Sleep diary method]]

![[sleep-stages-chart.png]]

Unfamiliar words go in the [[Glossary]].
`,
    'Sleep stages': `*A note about the stages of a night's sleep*

Sleep runs in cycles of roughly 90 minutes. Early cycles are heavy in deep sleep; later ones have longer REM periods.

| Stage | What happens | Share of the night |
| --- | --- | --- |
| N1 | Drifting off | About 5% |
| N2 | Light sleep, [[Sleep spindles]] | About 50% |
| N3 | [[Slow-wave sleep]] | About 20% |
| REM | Dreams, [[REM and emotional memory]] | About 25% |

This is why a short night costs you REM more than deep sleep: it's the late cycles that go missing.

![[sleep-stages-chart.png]]
`,
    'Memory consolidation': `*A note about how new memories become stable*

Consolidation is the process that turns a fragile new trace into something lasting. The main idea I keep coming across: during sleep, the brain replays recent experience and moves it from short-term storage toward long-term networks.

Three main ideas:

- New memories begin in the hippocampus, which learns fast
- During [[Slow-wave sleep]] those patterns replay
- [[Sleep spindles]] seem to time the transfer to the cortex

Sleep doesn't strengthen everything evenly. Things tagged as relevant to the future seem to benefit most, which is a big topic in [[Open questions]].

This is why I moved my flashcards to the evening, see [[Spaced repetition routine]].
`,
    'Slow-wave sleep': `*A note about deep sleep and declarative memory*

Slow oscillations, about one per second, sweep across the cortex. Their up-states seem to be the moments when memory replay happens.

Most of the work comes in the first half of the night. Experiments that boost slow waves with quiet sounds report better word-pair recall the next morning, but the effect size varies a lot. See [[Targeted memory reactivation]].

Part of [[Memory consolidation]]; also relevant to [[Sleep deprivation effects]].
`,
    'Sleep spindles': `*A note about sleep spindles*

Short bursts of activity at 11 to 16 Hz, mostly in N2. People with more spindles tend to do better on overnight memory tests, although it's unclear which way the arrow goes.

The nice part is the timing: spindles nest inside slow oscillations, and ripples from the hippocampus nest inside spindles. A three-layer clock.

- See [[Sleep stages]] for where they sit
- Definitions in the [[Glossary]]
- Naps with lots of N2 count too, see [[Naps and learning]]
`,
    'REM and emotional memory': `*A note about what REM does for feelings*

One view: REM keeps the content of an emotional memory while softening its emotional charge. Another: it helps with creative links between unrelated ideas.

The evidence is mixed. Blocking REM with medication barely changes declarative memory, which is awkward for the simple story. Filed under [[Open questions]].

Stages are in [[Sleep stages]].
`,
    'Targeted memory reactivation': `*A note about cueing memories during sleep*

The design is clever. You learn something while a sound or a smell is present, then the cue is replayed softly during deep sleep. Recall of cued items improves over uncued ones.

- Works best in [[Slow-wave sleep]]
- The effect is small but has been repeated many times
- Cueing too loudly just wakes people up

Could this work with language study? One small study tried it with vocabulary. Thinking about it in [[Study design notes]].
`,
    'Naps and learning': `*A note about naps*

A 60 to 90 minute nap can include slow-wave sleep and spindles, and it shows benefits similar to a night's sleep for word lists. Even a short 20-minute nap seems to help alertness, though less so memory.

I tried a nap after a Japanese lesson for two weeks. Results are in the [[Sleep diary method]] note. Not exactly rigorous. It did make [[Listening practice]] in the evening feel easier.
`,
    'Sleep deprivation effects': `*A note about what losing sleep does*

One night without sleep cuts the ability to form new memories by a noticeable amount the next day, not only recall of old ones. People also underestimate how impaired they are.

| Lost sleep | Effect I read about |
| --- | --- |
| One full night | Worse encoding, worse mood |
| A week at 6 hours | Slow decline in attention |
| Recovery weekend | Partial recovery only |

Related to [[Caffeine timing]] and [[Slow-wave sleep]], which rebounds on the next night.
`,
    'Reading log': `*A note about what I've read so far*

| Date | Source | Topic | Worth rereading |
| --- | --- | --- | --- |
| 2026-08-30 | Review article on sleep and memory | [[Memory consolidation]] | Yes |
| 2026-09-12 | Textbook chapter on sleep physiology | [[Sleep stages]] | Yes |
| 2026-09-27 | Paper on cueing during sleep | [[Targeted memory reactivation]] | Yes |
| 2026-10-09 | Meta-analysis of nap studies | [[Naps and learning]] | No |
| 2026-10-24 | Commentary on REM suppression | [[REM and emotional memory]] | Maybe |

Questions that came up go in [[Open questions]].
`,
    'Open questions': `*A note about the things I still don't understand*

- Does sleep protect memories, or actively improve them? See [[Interference and sleep]].
- Why does blocking REM barely change memory? See [[REM and emotional memory]].
- What decides which memories get replayed?
- How much of this holds for learning a language over months, not word pairs overnight?

The last one is the one I actually care about. A rough idea is in [[Study design notes]].
`,
    'Study design notes': `*A note about a small self-experiment I could run*

Compare two sets of Japanese vocabulary over four weeks: one reviewed in the morning, one reviewed before bed. Measure recall a week later.

| Task | Status | Due |
| --- | --- | --- |
| Pick 80 words of equal difficulty | Done | 2026-10-18 |
| Set up a morning and an evening deck | Doing | 2026-11-08 |
| Start the [[Sleep diary method]] | Doing | 2026-11-08 |
| Run the test after four weeks | To do | 2026-12-13 |

It's only one person with no control over the rest of life. Still more fun than guessing. Uses the [[Spaced repetition routine]].
`,
    'Caffeine timing': `*A note about coffee and sleep*

Caffeine has a half-life of about five to six hours, so an afternoon coffee is still half there at bedtime. It reduces deep sleep even when you fall asleep fine.

My rule now: last coffee before noon. I'm breaking it about twice a week. I log it in the [[Sleep diary method]].
`,
    'Sleep diary method': `*A note about how I track my sleep*

A simple table each morning, in the daily note. No devices, because I don't trust the stage estimates anyway.

- Time in bed and time up
- Rough quality from 1 to 5
- Late coffee: yes or no
- Nap: yes or no

Two weeks of naps looked mildly positive, see [[Naps and learning]]. Used by [[Study design notes]].
`,
    'Forgetting curve': `*A note about how quickly we forget*

Without review, memory for new facts drops steeply in the first day and then flattens. Each review resets the curve at a higher level, so the gaps between reviews can grow.

![[forgetting-curve.png]]

This is the logic behind the [[Spaced repetition routine]], and the reason I limit new kanji in the [[Kanji study method]]. Sleep between sessions helps too, see [[Memory consolidation]].
`,
    'Interference and sleep': `*A note about the passive explanation for sleep's benefit*

The older idea: sleep helps simply because nothing new comes in to overwrite what you learned. There's some truth in it, but quiet waking rest doesn't match sleep, so it can't be everything.

Practical bit: stop studying new things close to bedtime, and just review. I do this now with [[Listening practice]]. On the list of [[Open questions]].
`,
    Glossary: `*A note about the terms I keep looking up*

- Consolidation: stabilising a new memory, see [[Memory consolidation]]
- Declarative memory: facts and events you can state
- Encoding: taking in something new
- Hippocampus: fast-learning structure, key for new memories
- Replay: reactivation of a recent activity pattern
- Spindle: short burst in N2, see [[Sleep spindles]]
- Slow oscillation: the rhythm of [[Slow-wave sleep]]
`,
  },
}

/** Renovation's lanes and their cards, in board order. */
export const BOARD = {
  name: 'Renovation',
  lanes: [
    {
      title: 'To do',
      color: 'blue',
      cards: [
        { name: 'Order worktop samples', priority: 'high', start: '2026-11-06', due: '2026-11-11', body: '- [ ] Quartz, warm white\n- [ ] Oak offcut for the island\n\nSee [[Worktop materials]].\n' },
        { name: 'Confirm tile quantity', priority: 'medium', due: '2026-11-13', body: 'Just under 3 square metres plus 10% spare. See [[Splash-back tiles]].\n' },
        { name: 'Book the electrician', priority: 'high', due: '2026-11-18', body: 'First fix in the second week of January. Bring the drawing from [[Electrics]].\n' },
        { name: 'Choose the tap', priority: 'low', due: '2026-11-25', body: 'Tall spout, pull-out spray. See [[Sink and tap]].\n' },
      ],
    },
    {
      title: 'Doing',
      color: 'orange',
      cards: [
        { name: 'Compare cabinet quotes', priority: 'high', start: '2026-11-03', due: '2026-11-09', body: 'Both quotes are in the [[Budget]]. Ask the joiner about delivery dates.\n' },
        { name: 'Measure the pantry wall', priority: 'medium', start: '2026-11-04', due: '2026-11-10', body: '- [x] Width at floor level\n- [ ] Width at ceiling level\n- [ ] Depth by the radiator pipe\n\nFor the [[Pantry wall]].\n' },
      ],
    },
    {
      title: 'Done',
      color: 'green',
      cards: [
        { name: 'Get a plumbing quote', priority: 'medium', completed: '2026-11-04', body: 'See [[Plumbing notes]].\n' },
        { name: 'Test the paint samples', priority: 'low', completed: '2026-10-25', body: 'Warm off-white won. See [[Paint colours]].\n' },
        { name: 'Sign the floor plan', priority: 'high', completed: '2026-10-16', body: 'Final version in [[Floor plan]].\n' },
      ],
    },
  ],
}

/** The fourteen days up to the demo's "today": a few lines each, newest last. */
export const DAILY = {
  '2026-10-24': 'Saturday. Paint samples are up on the north wall. Read a commentary for the [[Reading log]].\n\n- Slept 7h 30, quality 4\n- Late coffee: no\n',
  '2026-10-25': 'Checked the samples at 4 pm. The cool one goes grey, as expected. Warm off-white wins, see [[Paint colours]].\n\n- Slept 8h, quality 4\n- Nap: yes\n',
  '2026-10-26': 'Twenty minutes of [[Listening practice]] on the way in. Understood one whole sentence without trying, which felt great.\n\n- Slept 6h 45, quality 3\n- Late coffee: yes\n',
  '2026-10-27': 'Evening reviews took ten minutes. Kanji for "read" finally stuck.\n\n- Slept 7h 15, quality 4\n',
  '2026-10-28': 'Long call with the joiner about [[Cabinets]]. Solid board costs more than I hoped.\n\n- Slept 7h, quality 3\n- Late coffee: yes\n',
  '2026-10-29': 'Plumbing quote came in below our estimate. A rare event. Updated the [[Budget]].\n\n- Slept 7h 40, quality 4\n',
  '2026-10-30': 'Five minutes of [[Shadowing]] before work. My neighbour must think I talk to the wall.\n\n- Slept 7h 20, quality 4\n- Nap: no\n',
  '2026-10-31': 'Cleared out the cupboards under the sink. Found three identical graters.\n\n- Slept 8h 10, quality 5\n',
  '2026-11-01': 'Quiet Sunday. Read about [[Sleep spindles]] and redrew the night chart by hand. Made lentil soup.\n\n- Slept 8h, quality 4\n- Nap: yes\n',
  '2026-11-02': 'Set up two decks for the [[Study design notes]]. Picked words of similar difficulty, more or less.\n\n- Slept 6h 50, quality 3\n',
  '2026-11-03': 'Lesson went well. Used [[Particles wa and ga]] correctly twice in a row and got a small nod.\n\n- Slept 7h 30, quality 4\n',
  '2026-11-04': 'Measured the pantry wall at floor level. It is not square. Nothing in this house is.\n\n- Slept 7h, quality 3\n- Late coffee: yes\n',
  '2026-11-05': 'Went through [[Contractor questions]] with the builder. Screed drying time is still unclear.\n\n- Slept 7h 45, quality 4\n',
  '2026-11-06': 'Compare the two cabinet quotes tonight. Evening reviews after that.\n\n- Slept 7h 25, quality 4\n',
}

export const WEEKLY = {
  '2026-W43': '### This week\n\nPaint decision made. Started the [[Reading log]] entry on REM.\n\n### Next week\n\nGet the plumbing quote, book a call with the joiner.\n',
  '2026-W44': '### This week\n\nPlumbing quote under estimate. Spoke to the joiner. Ten days in a row of [[Spaced repetition routine]].\n\n### Next week\n\nStart the morning and evening decks. Measure the [[Pantry wall]].\n',
  '2026-W45': '### This week\n\nMeasured the wall, set up both decks, went through questions with the builder.\n\n### Next week\n\nOrder worktop samples. Book the electrician.\n',
}
