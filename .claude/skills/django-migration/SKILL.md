---
name: django-migration
description: Create, check and test a Django migration after a model change in backend/ (schema or data migration, renumbering against open PRs, reversibility, migration tests). Use whenever a models.py file changes or a migration is added, edited or renumbered.
---

# Django migration

Rules this procedure relies on live in `CLAUDE.md` ("Backend Rules", "Crop
Data Rules", "Testing Rules") and `docs/testing-and-ci.md`. Read the deep-dive
doc of the model's area (`docs/index.md`) before changing the model.

## 1. Before generating

- Units: physical measurements are stored in SI units; document the unit in
  the field's `help_text`.
- Crop-species names, synonyms and translations are never seeded by a data
  migration; they go through the crop-species API. Never edit or read
  `backend/crops/migrations/data/species_bootstrap_v1.json`.
- Check open PRs for migrations in the same app, so the number does not
  collide when both merge:
  `gh pr list --state open --json number,headRefName,files --jq '.[] | select(any(.files[]; .path | test("migrations/\\d{4}_"))) | "\(.number) \(.headRefName)"'`

## 2. Generate

```bash
cd backend
pdm run makemigrations <app>   # farm, crops, accounts, …
pdm run python manage.py makemigrations --check --dry-run   # must print "No changes detected"
pdm run migrate
```

Django needs `backend/.env`; a fresh worktree has none, so copy it from the
main checkout first (otherwise: `SECRET_KEY must be set explicitly`).

Give a generated migration a descriptive name (`--name add_crop_tags`) instead
of `auto_<timestamp>`. One model change, one migration; do not squash or edit
migrations that are already on `main`.

## 3. Hand-written migrations (`RunPython` / `RunSQL`)

- Provide a reverse operation (`reverse_code`), or `RunPython.noop` when
  reversing is genuinely a no-op; never leave a migration irreversible
  without saying why in the PR.
- Use `apps.get_model(...)`, never import application models or services.
- Process large tables in batches (`.iterator()`, `bulk_update`).
- A hand-written migration triggers the automated Claude code review
  (`.github/workflows/claude-pr.yml`); expect it.
- Test it in a `test_migrations_*.py` file next to the app's other migration
  tests: migrate back to the predecessor, build the fixture rows, migrate
  forward, assert, and migrate forward to the leaf nodes again in teardown
  (`docs/testing-and-ci.md`, "The migration tests are the expensive ones").

## 4. Verify

```bash
cd backend
pdm run test <app>/tests/test_<area>.py <app>/tests/test_migrations_<name>.py
pdm run ruff check .
```

If the model change touches a serializer with relational fields, extend
`farm/tests/test_api_query_counts.py` (see "Testing Rules").

## 5. Ship

- The migration goes in the same commit as the model change.
- Update `docs/data-model.md` (and the area doc) when the data model changes.
- In the PR description, say whether the migration is schema-only or touches
  data, and whether it is safe to roll back (`ops/deploy/rollback.sh` restores
  the pre-deploy dump only when told to).
