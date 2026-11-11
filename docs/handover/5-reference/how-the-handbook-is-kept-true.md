# How the handbook is kept true

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Developers | about 6 min | [Glossary](glossary.md) | none |

A handbook goes wrong in three ways: the code moves and the page does not, a file or a folder is left out, and the prose picks up habits that nobody chose. This one is built so that each is a check that fails. This page says how, for whoever has to change the handbook.

## The parts that are written by a program

Some blocks of this handbook come from the code and are never typed. Each sits between two marker lines, and `npm run handover:build` rewrites whatever is between them.

| Marker | What it writes |
|---|---|
| `gen:card <file>` | A code file's card: its size, its exports with the first sentence of each comment, what it imports, who imports it, and which tests import it |
| `gen:files <folder>` | A table of the code files directly in a folder, with their sizes. The last column is written by a person and survives a rewrite |
| `gen:tree <folder>` | A tree of a folder, to a depth, with or without files |
| `gen:snippet <file>#<name>` | The real code of a declaration, with its place in the file. `lines=a-b` takes part of it, and `#La-b` takes lines of a file that has no declaration to name, such as a stylesheet |
| `gen:symbols` | The A to Z index of every exported name |
| `gen:testsmap` | Every test file with its count of tests, its first title, and the code it imports |

A marker inside a fenced block that is not itself a generated block is an example and is left alone, which is how this page can show one. The build also writes each page's reading time in its box, from the words and the quoted lines.

## The fingerprint of a quote

The explanation beside a quoted piece of code is written by a person, and a person can fall behind the code. So each snippet carries `sha=`, a short fingerprint of the whole declaration it quotes, taken when the explanation was written. When the code under it changes, the checker fails with the old and the new fingerprint, and says to read the explanation again.

1. Read the explanation against the new code. If a sentence is no longer true, change the sentence.
2. Then run `node tools/handover/build.mjs --accept docs/handover/2-code/<page>.md`. That writes the new fingerprint, and it is the statement that the explanation was read again.

Nothing else writes a fingerprint over a different one. A build without `--accept` fills one that is missing, and reports one that differs.

## The rules

`npm run check:handover` runs `tools/check/handover.check.mjs`, the eleventh checker, and it is part of `npm run check`, of `npm run verify` and of CI. It is read-only. Each rule is a function of text, so it has a self-test with a bad input and a good one.

| Rule | What it requires |
|---|---|
| blocks | Every generated block is what the build writes today, the reading time is right, and the code under each snippet is the code its explanation was written against |
| manifest | The pages listed in `docs/handover/manifest.json` exist, and every page on disk is listed. A part that is `planned` is not checked for completeness, and one that is `complete` is |
| box | Every page opens with the box: who it is for, reading time, read first, read next |
| headings | One title, and no level skipped |
| folders | Each folder of the source roots has a description, once part 1 is complete |
| cards | Each code file has exactly one card, with at least twelve words of a person's writing above it, once part 2 is complete |
| purposes | Each file in a file table says in a few words what it is |
| everyone | Part 0 has no code in it: no fenced block, no identifier and no path |
| summary | Each page of part 0 has a five-line Indonesian summary under its box |
| snippets | Quoted code in part 2 is followed by an explanation of at least forty words, and a run of quotes may end in one |
| generated | The A to Z index and the tests map each hold their block |
| references | A name or a repository path in backticks exists in the code |
| style | No em dash, no en dash, no double hyphen, no curly quote, no emoji, no hidden character, and none of a short list of phrases a person would not choose. The rule reads quoted code too, because a dash is a dash anywhere |
| secrets | No address, no mailbox, no token, no home folder and no internal host name. The repository is public, and a page is a place a secret can be pasted into |
| copies | The page about the two copies names every file that is meant to differ |

The generated pages, the index and the tests map, are exempt from the rules about words. They are still held to the rules about characters and secrets.

## Adding and changing pages

1. A new page is a line in `docs/handover/manifest.json` and a file with the box under its title. The reading time is written by the build, so any value passes the first time.
2. A new code file needs a card, and a new folder of source needs a description in part 1. The checker says which is missing.
3. Quote code with `gen:snippet`, never by pasting it. A quote of a line that holds a dash, a curly quote or a long hexadecimal string fails the style and the secrets rules, and is cut with `lines=` or described.
4. Do not link a page that does not exist yet. The links checker fails on it, so a forward reference is plain text until the page is written.
5. A diagram is a `.mmd` source in `docs/handover/diagrams/`, rendered to a PDF and a PNG beside it with `mermaid-cli` and the installed Chrome, then looked at, then stamped with `node tools/check/diagrams.stamp.mjs`. The diagrams checker holds the stamp.
6. Everything the handbook says about a number, such as how many routes or how many checkers, is checked by `facts.check.mjs` where the number has a form it reads. A number in prose that it does not read is the writer's to keep true, and the way to keep it true is to say it once and link to the page that owns it.

## Where it lives

The tools are in `tools/handover/`: `build.mjs`, which is the command, and `lib/`, which holds `scope.mjs` (which files have cards), `model.mjs` (reading the code with TypeScript's parser), `render.mjs` (the blocks), `blocks.mjs` (the marker syntax) and `document.mjs` (a page's blocks and reading time). They use no package of their own: they read the code with the `typescript` package that `server/node_modules` already holds. The checker's tests are in `server/src/__tests__/handover-check.test.ts`.
