# The GitHub repository

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Operators and developers | about 4 min | [GitHub and CI](github-ci.md) | [Run it](../4-working/run-it.md) |

This page is about the repository of the local-model copy, `hcml-portal-ollama`, as it is on GitHub: where it is, what it holds, how to get it and what state it is in. [GitHub and CI](github-ci.md) says what runs on a repository once something is pushed to it.

## Where it is

| Item | Value |
|---|---|
| Logo | ![GitHub logo](../images/stack/github.png) |
| On GitHub | Dashboard-Zabbix-Prototype-Local_LLM |
| Address | https://github.com/Fxkra28/Dashboard-Zabbix-Prototype-Local_LLM |
| Branch | `main` |
| On the Mac | the folder `hcml-portal-ollama` |

The names differ. GitHub calls the repository Dashboard-Zabbix-Prototype-Local_LLM, while the folder on the Mac, the Compose project and this handbook call it `hcml-portal-ollama`. A clone is made in a folder named after the GitHub name, so rename it if the name matters to you.

## What it holds

The code of the local-model copy: the server in `server/`, the web app in `web/`, the deployment files in `deploy/` and `docker-compose.yml`, the checkers in `tools/`, and the documents in `docs/`, with this handbook in `docs/handover/`. It holds the tracker, the changelog, the audit report, the security policy and the settings of the secret scan too, and the workflow and update bot in `.github/`.

It does not hold the settings files, which hold the secrets, nor the override file that holds HCML's Zabbix address. It leaves out the folders that npm and the builds make, the screenshots taken for the pictures, the report files and the portal's saved state.

The licence file grants none. The code is published to be read and reviewed, and without the author's written permission it may not be copied, changed, passed on or run for another organisation. The security policy asks for reports through GitHub's private vulnerability reporting, which is not switched on yet. Until it is, the policy says to open an issue that says only that a security report exists.

## How to get it and run it

1. Clone it. Git makes the folder.

   ```text
   git clone https://github.com/Fxkra28/Dashboard-Zabbix-Prototype-Local_LLM.git
   ```

2. In the folder, copy `.env.example` to `.env` and set `ZBX_URL`, `ZABBIX_API_TOKEN`, `JWT_SECRET` and `PORTAL_PASS`. The token comes from Zabbix and is read-only; [Run it](../4-working/run-it.md) says how to make it.
3. Start it with `docker compose up -d --build`. The local-model portal answers on port 8082, and `curl -s localhost:8082/bff/api/health` is the first check.
4. Start Ollama on the same machine. It has to listen where the container can reach it, and it has no sign-in of its own, so it must not listen on every address. [AI providers](ai-providers.md) has the details.

[Run it](../4-working/run-it.md) and [Deploy, rebuild and roll back](../4-working/deploy-rebuild-rollback.md) have the rest, and the first install on a Linux server has not been tried yet.

## How it relates to the first copy

The first copy, `hcml-portal`, has a repository of its own, with a longer history that began in September. The two hold the same source: after every change a sync brings the shared files equal, and a checker fails on any difference apart from the files meant to differ ([The two copies](../1-folders/the-two-copies.md)). One repository with two deployment profiles is proposed and not done.

## Where it stands

On 16 November 2026 the repository holds two commits. The first, on 11 November, brought the local-model copy in. The second, on 12 November, brought the shared files equal again and the files that differ by design. The owner has not yet committed the work of 12 to 16 November, more than three hundred paths, so the portal that runs on the Mac is built from the working folder, and its build is labelled with the last commit and `-dirty`.

Nobody has recorded whether this repository is private. Before the next commit and push, decide who may read each repository. The open items on this, on the checks that have never run on GitHub and on the secret in the first copy's public history are in [What is still open](../5-reference/open-items.md), and in plain words in [Open problems](../5-reference/open-problems.md).
