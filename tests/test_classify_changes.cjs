const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classify } = require('../scripts/ci/classify_changes.cjs');

const releaseBump = {
  'backend/config/version.py': ['VERSION = "1.181.0"', 'VERSION = "1.181.1"'],
  'backend/pyproject.toml': ['version = "1.181.0"', 'version = "1.181.1"'],
};

test('a release version bump is metadata-only', () => {
  assert.equal(classify(Object.keys(releaseBump), releaseBump).metadataOnly, true);
});

test('documentation and root Markdown are metadata-only', () => {
  const files = ['docs/testing-and-ci.md', 'docs/images/x.png', 'README.md', 'CHANGELOG.md', '.claude/skills/x/SKILL.md'];
  assert.equal(classify(files).metadataOnly, true);
});

test('any application, workflow, script or dependency change runs everything', () => {
  for (const file of ['frontend/src/App.tsx', '.github/workflows/ci.yml', 'scripts/ci/classify_changes.cjs',
    'frontend/package-lock.json', 'backend/pdm.lock', 'frontend/README.md', 'tests/test_x.cjs']) {
    assert.equal(classify(['docs/a.md', file]).metadataOnly, false, file);
  }
});

test('the API guide is served by the backend and therefore not metadata', () => {
  assert.equal(classify(['docs/api.md']).metadataOnly, false);
});

test('a version file that changes anything besides its version line runs everything', () => {
  assert.equal(classify(['backend/pyproject.toml'], {
    'backend/pyproject.toml': ['version = "1.0.1"', '"django>=6.0"'],
  }).metadataOnly, false);
  assert.equal(classify(['backend/config/version.py'], { 'backend/config/version.py': [] }).metadataOnly, false);
  assert.equal(classify(['backend/config/version.py']).metadataOnly, false);
});

test('an empty or undeterminable diff fails closed', () => {
  assert.equal(classify([]).metadataOnly, false);
});
