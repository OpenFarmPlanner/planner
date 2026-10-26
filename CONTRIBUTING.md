# Contributing

## Initial setup

After cloning the repo, run once to activate the project's git hooks:

```bash
make setup
```

This configures the pre-commit hook that warns you when an unusually large number of files are staged for deletion — which catches the common mistake of silently losing source files after a `git stash pop` conflict during a rebase.

## Logo and brand assets

The OpenFarmPlanner logo is excluded from the AGPL-3.0 (see [TRADEMARKS.md](TRADEMARKS.md)). Contributions to the logo or other brand assets are not accepted under the AGPL; they need prior agreement via info@openfarmplanner.org.

## Conventional Commits

This project uses Conventional Commits for automated versioning and releases.

All **commit messages** and **PR titles** must use Conventional Commits.

`type(scope): description`

Examples:

- `feat(crop-planner): add crop filtering by planting date`
- `fix(api): correct timezone conversion for harvest dates`
- `docs: update setup instructions for PDM`
- `refactor(frontend): extract useCrops hook`
- `test(backend): add tests for yield calculation`

### Allowed types

Valid prefixes for this repository are:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`
- `ci`
- `build`
- `perf`

Do not use free-form prefixes such as:

- `Invitation`
- `Update`
- `Improvement`
- `Changes`
- `Misc`
- `Work in progress`

PR titles are validated by GitHub Actions and must follow the same Conventional Commit format as commit messages.

### How to choose the correct type

Choose the type based on the intended user-visible impact:

- `feat:` only for new user-visible functionality
- `fix:` only for bug fixes or corrected behavior
- `refactor:` for internal restructuring without intended behavior change
- `docs:` for documentation-only changes
- `test:` for test-only changes
- `ci:`, `build:`, `chore:` for tooling, infrastructure, dependencies, or maintenance
- `perf:` for performance improvements

Important: do not use `feat:` or `fix:` unless the change should trigger a release.

### PR title examples

Valid PR titles:

- `feat(auth): add email-based registration`
- `fix(api): show mail failures as warning`
- `refactor(frontend): simplify version endpoint usage`
- `docs: update release workflow documentation`
- `chore(ci): align release workflow permissions`

Invalid PR titles:

- `Invitation: show mail failures as warning`
- `Update frontend origin handling`
- `Changes for release workflow`
- `Misc fixes`

### Breaking changes

Use either:

- `feat!: change API contract`

or include in the body:

- `BREAKING CHANGE: description`

### Release behavior

- `fix:` -> patch release
- `feat:` -> minor release
- `type!:` or `BREAKING CHANGE:` -> major release
- `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `style`, `perf` -> no release

## AI-assisted commits (Codex/Copilot)

When creating commits or PR titles with AI assistance, always use Conventional Commits.

Before creating a commit or PR title:

1. Classify the change type correctly.
2. Use a valid Conventional Commit prefix.
3. Ensure the title starts with `type:` or `type(scope):`.
4. Do not use arbitrary prefixes.
5. Use `feat` and `fix` only when a release should be triggered.
