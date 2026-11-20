# Contributing

Read [AGENTS.md](AGENTS.md) first. Its rules bind people and agents alike: read-only job boards except approved applications, caps never bypassed, claims only, personal data only in the workspace.

## Set up

Follow [docs/setup.md](docs/setup.md) steps 1 to 5. You do not need a workspace or any account to work on the code: `npm test` runs every test against a temporary copy of the synthetic workspace in `tests/fixtures/workspace`, with browser launches blocked.

## Before you open a pull request

- `npm test`, `npm run check:portable` and `npm run check:pii` pass. The pre-commit hook runs the two checks on staged files.
- Synthetic data only. Never commit a workspace file, a real job posting, a capture of a real page that is not scrubbed, or anyone's personal data. Integrations with public career sites are fine.
- No live runs. Tests never open a job board, an applicant tracking system or a mailbox.
- A change in behavior updates the doc, skill and template that describe it, in the same change.
- New selectors start as `?` in `docs/platforms.md`. Only a headed run confirms one.

## Commits

Conventional commits (`type(scope): subject`), one logical change each, files staged by name. No tool attribution trailers. Details: [docs/acf/git/commit-conventions.md](docs/acf/git/commit-conventions.md). The `docs/acf/backlog/` files describe the ACF plugin workflow; you do not need the plugins.

## License

Contributions are made under the Apache License 2.0, as section 5 of [LICENSE](LICENSE) describes.
