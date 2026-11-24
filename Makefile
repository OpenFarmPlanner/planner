.PHONY: setup quality bump-version release-e2e

setup:
	git config core.hooksPath .githooks
	@echo "Git hooks configured. Pre-commit hook will warn on bulk file deletions."

quality:
	./scripts/quality.sh

bump-version:
	@if [ -z "$(TYPE)" ]; then echo "Usage: make bump-version TYPE={feat|fix|breaking}"; exit 1; fi
	python3 scripts/bump_version.py --change-type $(TYPE)

release-e2e:
	@python3 -m scripts.ci.dispatch_release_e2e
