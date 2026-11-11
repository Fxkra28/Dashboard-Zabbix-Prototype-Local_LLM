# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem, and do not put the details in a pull request.

Use GitHub's private vulnerability reporting: on the repository page choose **Security**, then
**Report a vulnerability**. Say what you found, where (the file, the endpoint or the setting), how to
reproduce it, and what it lets someone do. A report that includes a way to reproduce it with made-up data is
the easiest to act on. Do not send real monitoring data, and do not test against a portal you do not run.

If that button is not there, open an issue that says only that you have a security report and nothing else.
The maintainer will then arrange a private way to receive it.

This is a one-person project: a report is read when time allows, and no response time is promised.

## Supported versions

The project has no releases. A rebuild of the live portals is marked with a tag such as `live-2026-10-26`, which says what ran on a
day and is not a version, so the latest commit on `main` is the only version that is supported. A fix is a new commit; there are no back-ports.

## What is in scope

- the BFF in `server/`, the web app in `web/`, the nginx configuration in `web/nginx.conf`, and the Docker and Compose files;
- the way the portal reads Zabbix, signs users in and keeps its own secrets.

Not in scope: Zabbix itself, a deployment someone else runs, and a vulnerability in a dependency that is already
public (report it to that project; Dependabot proposes the update here).

## How the portal is meant to be secured

The portal reads Zabbix with a read-only token, has one write (acknowledge and close) behind a second token that is off
by default, signs users in with a session cookie, and sends its answers with `Cache-Control: no-store` under an
enforced Content-Security-Policy. The reasons are in [`docs/architecture/adr/`](docs/architecture/adr/), and the
operating notes in [`docs/operations/`](docs/operations/). A finding that shows one of those promises is not kept is the most useful kind.

## Secrets

No secret belongs in this repository. A `.env` file is never committed, the templates (`.env.example`) hold placeholders,
and the CI workflow is set to scan every push for secrets. It has not started a job yet (tracker IN-30), so until it does the maintainer scans by hand with gitleaks. If you find one that is real, report it as above, and do not use it.
