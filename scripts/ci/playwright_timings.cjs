const fs = require('node:fs');
const path = require('node:path');

/** Small structured log records keep successful-run timings available without traces. */
class PlaywrightTimings {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'test-results/e2e-timings.json';
    this.tests = [];
    this.fixtureSteps = new Map();
    this.selected = [];
  }

  onBegin(config, suite) {
    this.root = path.dirname(config.configFile);
    this.workers = config.workers;
    this.shard = config.shard;
    this.partition = process.env.E2E_PARTITION || null;
    this.selected = suite.allTests().map(test => this.describe(test));
  }

  describe(test) {
    return {
      id: test.id,
      file: path.relative(this.root, test.location.file).split(path.sep).join('/'),
      project: test.parent.project()?.name || '',
      title: test.titlePath().join(' › '),
    };
  }

  onStepEnd(test, result, step) {
    if (step.category !== 'test.step' || !step.title.startsWith('Fixture: ')) return;
    let parentFixture = null;
    for (let parent = step.parent; parent; parent = parent.parent) {
      if (parent.category === 'test.step' && parent.title.startsWith('Fixture: ')) {
        parentFixture = parent.title;
        break;
      }
    }
    const key = `${test.id}:${result.retry}`;
    const steps = this.fixtureSteps.get(key) || [];
    steps.push({ title: step.title, duration_ms: step.duration, parent_fixture: parentFixture });
    this.fixtureSteps.set(key, steps);
  }

  onTestEnd(test, result) {
    const fixtures = this.fixtureSteps.get(`${test.id}:${result.retry}`) || [];
    this.tests.push({
      ...this.describe(test),
      status: result.status,
      retry: result.retry,
      duration_ms: result.duration,
      fixture_ms: fixtures.filter(step => step.parent_fixture === null)
        .reduce((sum, step) => sum + step.duration_ms, 0),
      fixture_steps: fixtures,
    });
  }

  onEnd(result) {
    const files = new Map();
    for (const test of this.tests) {
      const file = files.get(test.file) || { file: test.file, duration_ms: 0, fixture_ms: 0, attempts: 0 };
      file.duration_ms += test.duration_ms;
      file.fixture_ms += test.fixture_ms;
      file.attempts += 1;
      files.set(test.file, file);
    }
    const report = {
      schema: 1,
      status: result.status,
      started_at: result.startTime.toISOString(),
      duration_ms: result.duration,
      workers: this.workers,
      shard: this.shard,
      partition: this.partition,
      selected: this.selected,
      tests: this.tests,
      files: [...files.values()].sort((a, b) => b.duration_ms - a.duration_ms || a.file.localeCompare(b.file)),
      retries: this.tests.filter(test => test.retry > 0).length,
    };
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, `${JSON.stringify(report, null, 2)}\n`);
    // Emit after the progress reporter finishes, one bounded JSON object per line.
    // Titles and paths are data, never shell commands or log control sequences.
    console.log('\nE2E_TIMING_RUN ' + JSON.stringify({
      schema: report.schema, status: report.status, started_at: report.started_at,
      duration_ms: report.duration_ms, workers: report.workers, shard: report.shard,
      partition: report.partition, selected_count: report.selected.length, retries: report.retries,
    }));
    for (const selected of report.selected) console.log('E2E_TIMING_SELECTED ' + JSON.stringify(selected));
    for (const test of report.tests) console.log('E2E_TIMING_TEST ' + JSON.stringify(test));
    for (const file of report.files) console.log('E2E_TIMING_FILE ' + JSON.stringify(file));
  }
}

module.exports = PlaywrightTimings;
