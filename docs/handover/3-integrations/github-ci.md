# GitHub and CI

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 6 min | [Operations](operations.md) | [Repository map](../1-folders/repository-map.md) |

## What it is for

GitHub holds the repository of the first copy, `hcml-portal`, runs its checks on every push and pull request, and proposes updates to its packages and images. Nothing is deployed from it: a change goes live only when someone runs the rebuild script on the machine. The second copy, `hcml-portal-ollama`, has had a repository of its own, with a remote, since 11 November 2026, so the same workflow can run there; it has not run there either (IN-30). The workflow file is kept in both folders so that they stay identical, and the parity check is how that is verified.

## What runs

The workflow is `.github/workflows/ci.yml`. It starts on a push or a pull request to `main`, and by hand. A newer push to a branch other than `main` cancels an older run, since the older run is pointless. On `main` runs queue instead of being cancelled, because the secret scan reads only the commits of its own push. Every job runs on `ubuntu-24.04`, named by its version because GitHub is moving the `ubuntu-latest` label to 26.04; `ci-workflow.test.ts` fails on any `-latest` label, so moving on is one word in five places and a decision. The token it gets only reads: nothing here pushes, comments or deploys. Every action is pinned to a full commit hash, with the tag it came from in a comment after it, because a tag can be moved to other code and a hash cannot, and `ci-workflow.test.ts` fails on an action pinned any other way.

Five jobs run side by side, so a failure names its package.

| Job | Time allowed | What it does |
|---|---|---|
| Server | 15 min | Installs from the lockfile, audits the packages that ship, typechecks, lints, tests and builds |
| Web | 15 min | The same for the web app |
| Checks | 10 min | Installs the server's packages, which hold the TypeScript runner and the compiler the checkers use, then runs eleven checkers (below) |
| Secret scan | 10 min | Scans the commits that were pushed for secrets |
| Docker images | 20 min | Builds both images without pushing them, and runs nginx's own syntax check inside the web image |

The checkers, each a step with a name that says what it guarantees:

1. The API description and the routes the server registers agree.
2. The database diagram and its model agree.
3. The stylesheet is structurally sound.
4. The design tokens are legible and nothing reaches past them.
5. The Assistant's markdown parser.
6. The unit and duration formatters.
7. Every relative link in the documents resolves, spelled exactly.
8. The counts the documents state are the ones the code has.
9. Every diagram source matches its stamp and has its PDF.
10. The handover handbook matches the code and follows its rules.
11. The parity checker's own checks. CI holds one tree, so this runs only the script's own checks and says it compared nothing.

`npm run verify` at the root runs the same steps, apart from the installs, the audit, the secret scan and the image builds, and adds the typechecks, lint, tests and builds of both packages. It takes about five minutes. Run it before anything is committed.

## The secret scan

gitleaks scans the commits of the push or the pull request, not the whole history. So a leak already in history does not fail every run: the token in the first commit has to be revoked where it was issued, and history cannot be unpublished. The file `.gitleaks.toml` at the root keeps the default rules and sets aside three made-up test values, a throwaway TLS key for the pinned-TLS tests, a sample login token for the log test and a sample password for the password test, each by its own text. A different key or token in the same file, or any secret anywhere else, is still found. It posts no comments and uploads no findings, because on a public repository either would repeat what it found. A manual run has no commit range, so it skips this job. A repository owned by an organisation needs a licence secret for the scanner. A personal one does not.

## Dependabot

`.github/dependabot.yml` opens a pull request a week for the GitHub actions, for the npm packages of `server/` and of `web/` (minor and patch updates grouped in one, a major alone), and for the base image of each Dockerfile, which the digests would otherwise freeze. A pull request is a proposal. Each one changes a lockfile or a pinned digest and has to pass the same checks.

## The repository itself

| What | Notes |
|---|---|
| Public | The code is public. Anything committed is public. So no estate data, no credential, no real host name: the screenshots in the documents have every name replaced, and `pic/` and downloaded SLA reports are ignored |
| `LICENSE` | All rights reserved, which grants nothing and is the safe default for public code. Choosing a licence is the owner's |
| `SECURITY.md` | How to report a vulnerability. GitHub's private vulnerability reporting still has to be switched on by the owner |
| `.gitignore` | The settings files, installed packages, build output, logs, and the files above |
| `.nvmrc` | Node 24, which the Dockerfiles and CI use |
| Tags | `deploy/rebuild.sh` makes a local `live-<date>` tag on a clean build. It never pushes it |

## What is true now

As of 30 October 2026, CI has never run on GitHub. The account has a billing lock, so no workflow has started on any push, and fifteen Dependabot pull requests are open. The checks themselves pass on the developer's machine, and each job's steps were run by hand. The secret scan was run with the same engine against the commits of history. The first real run on GitHub may find a difference between the machine and the runner.

## How it fails

| What you see | Cause | What to do |
|---|---|---|
| An install step fails | A lockfile that does not match its package file | Run `npm install` in that package and commit the lockfile |
| The audit step fails | A high or critical advisory in a package that ships | Update the package. A Dependabot pull request may already propose it |
| A step of the Checks job fails | The check it names | Run `npm run check` at the root, and read the message: each names the file and the line |
| The secret scan fails | A secret in the pushed commits | Revoke it first, then remove it |
| The images job fails | A Dockerfile that no longer builds, or an invalid nginx file | Build the image locally |
| A test says an action is not pinned | A tag instead of a full hash | Take the hash from the release and keep the tag in the comment |

## Where the code is

| What | File |
|---|---|
| The workflow | `.github/workflows/ci.yml` |
| The workflow's own test | `server/src/__tests__/ci-workflow.test.ts` |
| The update settings | `.github/dependabot.yml` |
| The local equivalent | the `verify` and `check` scripts of the root `package.json` |
| The checkers | `tools/check/` and `web/scripts/` |
