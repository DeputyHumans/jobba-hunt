# Security

## Reporting a vulnerability

Report it privately: on GitHub, open this repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for it.

Never put personal data in a report, an issue or a pull request: no CV, email, phone number, token, cookie, screenshot of an application or capture of a signed-in page. Describe the problem with the synthetic persona the tests use (Jordan Example, Acme Corp).

## What counts

- A way for the scripts to submit, message, connect or change anything on a job board or an applicant tracking system without the operator's approval.
- A way around a guard: the daily caps, a halt, the pause, the per-company limit, the verified-channel check, the AI-applicant hand-off.
- A way for personal data to leave the workspace: into the repository, a commit, a published document, a log line or a third party.
- A credential exposure: browser profiles, `workspace/.secrets/`, the bikeshed or Google Workspace CLI tokens.

## Supported versions

Only the `main` branch is supported.
