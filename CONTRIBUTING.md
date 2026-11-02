# Contributing

Thanks for helping. Retrospend is maintained by one person, so small, focused contributions land fastest.

## Issues

- **Bugs:** use the bug report form. Include the version (Settings shows it), the platform, and steps to reproduce.
- **Ideas:** use the feature request form, and describe the problem before the solution.
- **Questions and help with self-hosting:** ask in the [Matrix chat](https://matrix.to/#/#retrospend:matrix.org).
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Read [AGENTS.md](AGENTS.md). It holds the rules every change follows, whether a person or an AI agent writes it: money, data, design language and words.
3. Set up with [docs/development.md](docs/development.md).
4. Keep the change to what the issue needs, and add tests.
5. Run `pnpm check` (and `pnpm test:pg` for server changes) before you open the PR.
6. For UI changes, add screenshots at desktop and phone width, light and dark.

By contributing, you agree your work is licensed under [GPL-3.0](LICENSE).
