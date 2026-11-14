const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseShard(value) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value || '');
  if (!match) throw new Error('Expected shard INDEX/TOTAL.');
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(total) || current > total) throw new Error('Invalid shard range.');
  return { current, total };
}

function discoverFiles(report, frontend) {
  if (report.errors?.length) throw new Error('Playwright test discovery failed.');
  const files = new Map();
  const ids = new Set();
  function visit(suite) {
    for (const spec of suite.specs || []) {
      const file = path.relative(frontend, path.resolve(report.config.rootDir, spec.file))
        .split(path.sep).join('/');
      if (!file.startsWith('e2e/') || file.includes('../')) throw new Error('Test outside the E2E directory.');
      const group = files.get(file) || { file, tests: [] };
      for (const test of spec.tests) {
        const id = `${spec.id}:${test.projectName}`;
        if (ids.has(id)) throw new Error('Duplicate discovered test.');
        ids.add(id);
        group.tests.push(id);
      }
      files.set(file, group);
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  if (!ids.size) throw new Error('No E2E tests discovered.');
  return [...files.values()];
}

function partition(files, profile, total) {
  if (profile.schema !== 1 || !profile.files || !Number.isSafeInteger(total) || total < 1 || total > files.length) {
    throw new Error('Invalid timing profile or shard count.');
  }
  const samples = Object.values(profile.files);
  if (!samples.length || samples.some(row => !Number.isSafeInteger(row.tests) || row.tests < 1
    || !Number.isFinite(row.duration_ms) || row.duration_ms <= 0)) {
    throw new Error('Invalid timing samples.');
  }
  const fallback = samples.reduce((sum, row) => sum + row.duration_ms, 0)
    / samples.reduce((sum, row) => sum + row.tests, 0);
  const weighted = files.map(group => {
    const previous = profile.files[group.file];
    return { ...group, estimated_ms: group.tests.length * (previous ? previous.duration_ms / previous.tests : fallback) };
  }).sort((a, b) => b.estimated_ms - a.estimated_ms || a.file.localeCompare(b.file));
  const shards = Array.from({ length: total }, (_, index) => ({ index: index + 1, estimated_ms: 0, files: [] }));
  for (const group of weighted) {
    const shard = [...shards].sort((a, b) => a.estimated_ms - b.estimated_ms || a.index - b.index)[0];
    shard.files.push(group);
    shard.estimated_ms += group.estimated_ms;
  }
  return shards;
}

function filePattern(file) {
  return `(^|/)${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

function main(value) {
  const { current, total } = parseShard(value);
  const frontend = path.resolve(__dirname, '../../frontend');
  const cli = path.join(frontend, 'node_modules/@playwright/test/cli.js');
  const listing = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
    cwd: frontend, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (listing.error || listing.status !== 0) {
    process.stderr.write(listing.stderr || 'Cannot discover E2E tests.\n');
    return 1;
  }
  const files = discoverFiles(JSON.parse(listing.stdout), frontend);
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e_timings.json'), 'utf8'));
  const shards = partition(files, profile, total);
  const selected = shards[current - 1];
  console.log('E2E_PARTITION ' + JSON.stringify({
    current, total, profile_source: profile.source, estimated_ms: selected.estimated_ms,
    test_count: selected.files.reduce((sum, file) => sum + file.tests.length, 0),
    files: selected.files.map(file => file.file).sort(),
  }));
  // File filters preserve all project variants and serial ordering inside each file.
  const result = spawnSync(process.execPath, [cli, 'test', ...selected.files.map(file => filePattern(file.file))], {
    cwd: frontend, stdio: 'inherit',
    env: { ...process.env, E2E_PARTITION: `${current}/${total}` },
  });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/ci/run_e2e_shard.cjs INDEX/TOTAL');
    process.exitCode = main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { parseShard, discoverFiles, partition, filePattern };
