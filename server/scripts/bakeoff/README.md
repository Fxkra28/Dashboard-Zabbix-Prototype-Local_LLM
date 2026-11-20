# The model bake-off

Fifty questions asked of one local model about a made-up estate, through the portal's own prompt and request code, and scored by rules that were fixed before any model ran. It decides which model the Assistant uses (the plan's P3.2). Nothing here is HCML's: the estate is invented, and nothing leaves the machine that runs it.

## What is in this folder

| File | What it is |
|---|---|
| `snapshot.txt` | The estate as the model reads it: 24 hosts at six sites, 22 open problems (the text lists the worst 20), one SNMP-silent host, a derived SLA for October. Built by the portal's own `buildSnapshot` from the invented data in `src/__tests__/bakeoff-fixture.test.ts`, and a test fails when the builder's format moves and this copy has not. |
| `questions.json` | The 50 questions: 20 in English, 20 in Bahasa Indonesia, 10 mixed or too short to place. Each has what the answer must contain and what it must not, the language it must be in, how long it may be, and a reference answer. |
| `score.ts` | How an answer is judged, and the pass marks. |
| `run.ts` | Asks one model the questions and writes `results/<model>.json`. |
| `rescore.ts` | Scores saved answers again after a question or a mark was mended. The model is not asked. |
| `env.ts`, `sample.ts`, `dump-sample.ts`, `prompt-sample.json` | `prompt-sample.json` holds the real prompts of four questions for `deploy/model-speed.py`, which runs on a machine that has no Node. A test keeps it equal to what the portal builds. |
| `results/` | The saved runs: every answer, what failed, and the times. |

## Running it

From `server/`, with Ollama running and the model pulled:

```
npx tsx scripts/bakeoff/run.ts --model qwen3:8b            # a few minutes on a card: the 50 answers of qwen3:8b took under three minutes on an Apple M5
npx tsx scripts/bakeoff/run.ts --model gemma4:12b --only 1,2,3
npx tsx scripts/bakeoff/rescore.ts scripts/bakeoff/results/qwen3-8b.json
```

`--base http://host:11434/v1` asks another Ollama. The run sets what the portal's `.env` sets in production (8,192 tokens of context, the thinking switch off for reasoning models, the sampling of the model's own card) and nothing else, so that a model is judged as it would run.

## What the marks are

A model is adopted when it reaches all four at once. They are in `PASS_MARKS` in `score.ts`:

| Mark | Needs | Why |
|---|---|---|
| overall | 80% of the 50 right | A question is right when every check below passes. |
| traps | all 6 | Six questions ask for what the data does not hold (a cause, a temperature, a CPU load, a name). The answer must say so and invent nothing. |
| language | 95% of those that name one | The answer is in the language of the question, by the portal's own word lists. A reply of host names alone is not held against a model. |
| format | 98% | No heading, table, code fence or tag, which the page cannot draw and the prompt rules out. Bold and "- " bullets are what the prompt asks for and are allowed. |

The questions were picked to include the three failures the tracker logged against the 8B model: a ranking read the wrong way (BK-17), a partial list taken for the whole (BK-20) and a verdict instead of a figure (BK-33).

## What it does not tell you

* **Patterns are a screen, not a judge.** An answer is right when its patterns match. Read the answers of every failed question before believing a number: after the first run one pattern was found to have rejected a right answer ("tidak mencapai target"), and three more would have rejected right wording ("20 of 22 are listed", "did not reach the target"). We widened them and re-scored the saved answers without asking the model again, which moved one answer. Nobody can say a pattern is complete. Read the answers that passed as well: on 18 November a second reading found that the denial pattern was satisfied by the data's own words, and eleven of the passes of `gemma4:12b` on the six traps were not denials.
* **One run is one draw.** The models sample, so a second run of the same model differs by a question or two. A candidate that is close to the baseline is run twice.
* **No FOCUS block.** In the portal a question that names a site or a host gets a block listing that site's hosts by state. The bake-off does not build it, so questions such as "Surabaya?" are harder here than in the portal. The comparison between models is fair, and the absolute figure is a little low.
* **The speed in the results is the Mac's, with the start of the prompt already read.** After the first question Ollama keeps the system text, so the median is far quicker than a person's first question of the day. Use `deploy/model-speed.py` on the machine for the speed that counts.
* **The estate is small.** 24 hosts is a few thousand tokens. The real estate is larger, so a model that does well here may read a longer text worse.
* **The questions are ours.** Whoever writes the questions shapes the result. They are in the file to be read and argued with.

## Results so far

All runs on 17 and 18 November 2026 (the times in the files are UTC), Ollama 0.33.3 on an Apple M5, answers asked with the portal's own prompt and the sampling of the portal's table for the model. `sailor2:8b`, which the table has no entry for, got the portal's defaults (temperature 0.7, top-p 0.8, no thinking field). Each run is in `results/`. The figures are as scored after the two mends of 18 November, which are described below the table.

| Model | Run | Right | Traps | Language | Format | Median answer | First word (warm / cold) | Adopted by the marks |
|---|---|---|---|---|---|---|---|---|
| `qwen3:8b` | one | 42 of 50 (84%) | 3 of 6 | 100% | 100% | 2.9 s | 0.2 s / 0.2 s | no |
| `qwen3.5:9b` | first | 46 of 50 (92%) | 5 of 6 | 100% | 100% | 6.1 s | 1.2 s / 18.9 s | no, on the traps |
| `qwen3.5:9b` | second | 48 of 50 (96%) | 5 of 6 | 100% | 100% | 6.8 s | 2.4 s / 8.7 s | no, on the traps |
| `gemma4:12b` | first | 49 of 50 (98%) | 5 of 6 | 100% | 100% | 3.8 s | 0.5 s / 18.3 s | no, on the traps |
| `gemma4:12b` | second | 49 of 50 (98%) | 5 of 6 | 100% | 100% | 3.5 s | 0.5 s / 15.3 s | no, on the traps |
| `sailor2:8b` | first | 36 of 50 (72%) | 1 of 6 | 100% | 100% | 8.4 s | 0.4 s / 17.1 s | no |
| `sailor2:8b` | second | 39 of 50 (78%) | 2 of 6 | 100% | 100% | 7.6 s | 0.4 s / 0.4 s | no |

The six traps asked eight more times of each of the three newer models (`results/trap-draws.json`): `qwen3.5:9b` got all six right in 6 of the 8 draws, `gemma4:12b` in none and `sailor2:8b` in none. Counting the full runs as well, that is 6 of 10 draws for `qwen3.5:9b` and none of 10 for the other two, and 56, 46 and 11 of the 60 answers right. By question, over those ten answers of each: `gemma4:12b` gets the cause of an outage right 6 times in English and never in Bahasa Indonesia, and every other trap 10 times; `qwen3.5:9b` gets the English one 9 times, the Bahasa Indonesia one 7 times and every other trap 10 times.

**What it shows.** No model meets the traps mark, and the two candidates fail it in different ways. `gemma4:12b` gets every one of the other 44 questions right in both runs and answers in about half the time of `qwen3.5:9b`, but when asked in Bahasa Indonesia it never says that the cause of an outage is not in the data (0 of 10 answers), and in English it says so in 6 of 10: it repeats the alert ("DELTA-SW01 tidak bisa dijangkau (Unavailable by ICMP ping)") or gives the alert as the cause. `qwen3.5:9b` is right on 41 and 43 of the other 44 and on 56 of the 60 trap answers; its four misses are the same question, three in Bahasa Indonesia and one in English, where it gives the failed ping as the cause. In both full runs it also names the wrong problem as the oldest when asked in Bahasa Indonesia (FOXTROT-FW01 where the data says CHARLIE-FW01). The marks put the traps first, since a model is adopted only when it gets all six right, and on them `qwen3.5:9b` is clearly ahead; `gemma4:12b` is ahead on every other question and on speed. `qwen3:8b` is behind both. `sailor2:8b`, built for the languages of South-East Asia, is the weakest of the four, and not for want of Bahasa Indonesia: its language mark is 100 percent like the others, and its answers in Bahasa Indonesia fail on the facts. It names three or four of the five unreachable hosts, says all 22 open problems are listed when the text lists 20 (in all four answers), and for what the data does not hold it makes up a CPU load in all ten answers, a CPU temperature in nine of ten and, for the person in charge of Surabaya, a name with a telephone number and an email address in three of ten. It is also the slowest (a median of 7.6 to 8.4 s, and 17 to 18 s at the slowest tenth). The rule of IN-96 (the model that passes the marks, and if none does, the best of those that were run) no longer points at one model: `gemma4:12b` is the better on accuracy and speed, and `qwen3.5:9b` on the marks that decide. They are also the larger files (8.0 GB and 6.6 GB against 5.2), and the machine's memory is not known (IN-97). Nothing here has run on the machine, whose speed is the one that counts (`deploy/model-speed.py`).

**The contacts in two saved runs are placeholders (19 November, DC-81).** Two of the answers to the question about the person in charge of a site (`trap-draws.json` and `sailor2-8b-draw2.json`) had made up e-mail addresses at HCML's domain and telephone numbers. They are now `name@example.org`, `+62 000-0000-0000` and `0000-0000-0000`, which the scoring patterns still read as an address and a number, so no verdict changes. Everything else in the saved answers is as the models wrote it.

**The scoring was mended on 18 November, for every model alike.** Reading the failed trap answers, five right answers had been turned away: two of `qwen3.5:9b` named "a hardware failure" or "power loss" only to say that the data does not say (the pattern forbids any mention of a cause), and three said "tidak mencantumkan nama ..." (does not list a name), a verb the pattern for "it is not in the data" did not know. The pattern for the two cause questions now counts a mention as invented only when no denial of saying or knowing comes before it in its own sentence, with no "but" or "however" in between (`negatedOk` in `questions.json`, tested in `bakeoff-score.test.ts`), and the Bahasa Indonesia list of verbs has five more (mencantumkan, mencatat, memuat, menyimpan, berisi). A guess followed by a denial is still invented, and so is a cause offered as the answer. Every saved run was scored again with `rescore.ts` and no answer changed. The effect was on the trap draws of `qwen3.5:9b`, which went from 3 to 7 of 8 with all six right; the full runs, and every run of `gemma4:12b`, kept their numbers. Before that mend `qwen3.5:9b` looked clearly behind `gemma4:12b` on the traps and after it the two were level, which shows how much of this result is a pattern.

**It was mended a second time the same day, after reading the answers that had passed.** The first mend turned away right answers; this one lets fewer wrong ones through. The pattern for what the data does not hold counts a denial ("not", "no", "tidak", "unavailable" followed by a word of saying or knowing), and the estate's own text is full of such words: an alert is named "Unavailable by ICMP ping", a host is "tidak bisa dijangkau" (cannot be reached) and an alarm is "not acknowledged". An answer that only repeated the alert passed as if it had said the data holds no cause, and so did a list of hosts offered as the people in charge. `scoreAnswer` now blanks those words before it looks for a denial on the six questions (`DATA_WORDS` in `score.ts`), the Surabaya question fails an answer that gives an email address or a telephone number, and the English pattern takes "determine", "identify", "confirm", "record" and a few more verbs of saying and no longer stops at the dots of a host name such as 4.2.1 (an answer that said "I cannot determine the cause of the outage for 4.2.1 DELTA-SW01" had passed only because of the alert's name, and would have failed without that last change). Every saved run and every saved draw was scored again: 25 answers went from right to wrong and none the other way, 11 of `gemma4:12b`, 10 of `sailor2:8b`, 2 of `qwen3.5:9b` and 2 of `qwen3:8b`. We read each of the 25: they repeat the alert without saying the cause is missing, give the alert or the failed ping as the cause, or make up a contact. Reading the answers that still pass for the same faults found one, a `sailor2:8b` answer that invents a temperature problem and adds "No need for further details". The effect on the choice is large. Before this mend `gemma4:12b` had 98 and 100 percent right and all six traps right in 6 of 8 draws; after it, 98 and 98 percent and none of 8, while `qwen3.5:9b` went from 7 of 8 to 6 of 8.

The eight that `qwen3:8b` misses after the patterns were widened: the two partial-list questions (it says all 22 problems are listed when the text lists 20), the oldest open problem asked in Bahasa Indonesia (it names the newest), the two questions about the cause of the outage (it gives the failed ping as the cause), a CPU load it was not given (it says "high" and does not say the figure is missing), a bare site name, and a summary with no total.

## What each model's own file and a live check show (18 November 2026)

Read with `ollama show` and tried on this Mac (Ollama 0.33.3, the models warm), through the native request the portal sends, with the portal's table of settings. The thinking-on times were taken while other work ran on the Mac, so read them as a size and not a figure; the thinking-off times were taken with nothing else running, as the median of five asks of each of two questions (one English, one Bahasa Indonesia). `sailor2:8b` was read and tried the same way later that day, without the thinking field, which the portal does not send to a model it has no card for.

| | `qwen3:8b` | `qwen3.5:9b` | `gemma4:12b` | `sailor2:8b` |
|---|---|---|---|---|
| Licence in the file | Apache License 2.0 | Apache License 2.0 | Apache License 2.0 | none: the file has no licence text (the Ollama library page says Apache 2.0) |
| Ollama it needs | none named | 0.30.0 or later | 0.30.9 or later | none named |
| On disk, context in the file | 5.2 GB, 40,960 | 6.6 GB, 262,144 | 8.0 GB, 262,144 | 5.2 GB, 32,768 |
| Sampling the file asks for (a thinking model's) | 0.6, 0.95, top-k 20 | 1.0, 0.95, top-k 20, presence 1.5 | 1.0, 0.95, top-k 64 | none (stop words only) |
| What the portal sends with thinking off (`PROFILES`) | 0.7, 0.8, top-k 20 | 0.7, 0.8, top-k 20, presence 1.5 | 1.0, 0.95, top-k 64 | no card: 0.7 and 0.8 from the configuration, no thinking field |
| First word, thinking off (English, Bahasa Indonesia) | 0.06 s, 0.08 s | 0.10 s, 0.12 s | 0.12 s, 0.13 s | 0.07 s, 0.07 s |
| Answer complete, thinking off (English, Bahasa Indonesia) | 1.0 s, 1.4 s | 5.2 s, 6.4 s | 1.1 s, 6.3 s | 1.7 s, 5.1 s |
| First word, thinking on (English, Bahasa Indonesia) | 17 s, 74 s | no answer in 3,000 tokens (310 s), 106 s | 170 s, 51 s | not applicable: the file lists completion only |
| A thought marker, or an empty answer, in any answer | none | none | none | none |
| An open question asked 4 times at temperature 0 with a seed, then 4 times with the portal's table | 1 answer, then 4 different | 1 answer, then 4 different | 1 answer, then 4 different | 1 answer, then 4 different |

What it means. The licence is the same for the first three, so it does not decide; `sailor2:8b` carries no licence text in its file, which HCML's IT would want to see settled before a fourth model is installed. The thinking switch is not optional: with it on, a model takes between 17 seconds and nearly three minutes to its first word, and `qwen3.5:9b` can spend the whole allowance on thinking and give no answer, which is why the portal sends `think: false` to these families. With it off, none of the answers of any run carries a thought marker or is empty (350 saved answers, and every answer of these checks), so the worry that `gemma4:12b` leaks an empty thought block into the page did not show. The file's own sampling is for a model that thinks, and the Qwen rows of the portal's table are the settings the published cards give for answers without thinking, so they differ from the files by design; Gemma 4's table is its file's. The sampling options reach the models: at temperature 0 with a seed the same question gives the same answer, and at the portal's settings it does not. `sailor2:8b` brings its first word as quickly as the others and its two short answers took 1.7 and 5.1 seconds, within the range of the others; what separates it is what it says.

`/v1` is slow only once. The first request on that route after the native ones took 7.5 seconds for `qwen3:8b`, 9.1 for `qwen3.5:9b` and 18.1 for `gemma4:12b`, and the next ones 0.1 to 0.8: it asks for no context size, so the model is loaded again with a small one (`ollama ps` showed 4096, against the 8192 the portal asks for). A portal that stays on one route does not pay it twice, and the portal speaks the native API when it finds Ollama. `sailor2:8b` was not tried on this route.
