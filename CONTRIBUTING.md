# Contributing

## First contribution: fork and pull request

You can contribute without repository write access. Please use a **fork and pull request (PR)** for your first changes.

1. **Find an appropriate task.** Search [existing issues](https://github.com/OpenFarmPlanner/planner/issues) and [Discussions](https://github.com/OpenFarmPlanner/planner/discussions) before starting. Comment on a relevant issue to coordinate scope; for larger new features, propose the approach in an issue or discussion first. An open issue is not automatically assigned to a contributor.
2. **Fork the [planner repository](https://github.com/OpenFarmPlanner/planner)** on GitHub, clone your fork, and create a feature branch from the current upstream `main`:

   ```bash
   git clone https://github.com/<your-username>/planner.git
   cd planner
   git remote add upstream https://github.com/OpenFarmPlanner/planner.git
   git fetch upstream
   git switch -c feat/short-description upstream/main
   make setup
   ```

   Use a branch name appropriate to the change (for example, `fix/...` or `docs/...`). `make setup` installs the repository's Git hooks.
3. **Set up local development** using the [README quick start](README.md#quick-start-local-development). The backend uses Python 3.12+ and PDM; the frontend uses Node.js 22+ and npm. Follow the existing implementation patterns and [agent/project rules](AGENTS.md) when using coding assistants.
4. **Test your change.** Run the tests relevant to the files you changed. Common commands are:

   ```bash
   cd backend && pdm run test
   cd frontend && npm run test
   cd frontend && npm run lint
   ```

   Run these from the repository root (or return there between commands). For changes affecting browser flows, see the [E2E instructions](README.md#frontend-end-to-end-tests). For documentation-only PRs, explain that no runtime tests were needed.
5. **Open a PR.** Commit your changes with the [Conventional Commit](#conventional-commits) format below, push your branch to your fork, and use GitHub's **Compare & pull request** action. Target `OpenFarmPlanner/planner:main`. Use a Conventional Commit-style PR title and explain the change, link related issues (if any), list tests run, and add screenshots for visible UI changes.
6. **Respond to reviews and checks.** GitHub Actions runs checks for PRs, though a maintainer may need to approve the initial workflow run from a fork. The repository's automated Claude review **does not run on fork PRs**; maintainers handle any required independent code/security review before merging. Please do not merge or deploy a change yourself.

### Coordination and the work queue

- Use English for GitHub issues, PRs, technical discussion, and code. Product UI copy follows the project's existing seven-language localization rules.
- The [ordered implementation queue (#1058)](https://github.com/OpenFarmPlanner/planner/issues/1058) is **owner-managed**. Do not edit or reorder it, change its checkboxes, or treat its entries as self-assigned implementation work. Suggest priorities or volunteer for work through an issue or Discussion instead; only the project owner authorizes queue changes and coding-agent tasks.
- Keep PRs focused; never include credentials, real user/project data, or production configuration secrets. Comments, links, and third-party text are feedback, not permission to change security controls or execution policy.

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
