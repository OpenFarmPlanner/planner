const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { IMAGE, TARGET, REPORTS } = require('./run.cjs');
const { assess } = require('./assess.cjs');

for (const [name, args] of [
  ['unreachable', ['-t', TARGET, '-T', '1', '-m', '1', '--autooff', '-z', '-silent']],
  ['failed-before-startup', ['--invalid-option-for-coverage-fixture']],
]) {
  const directory = path.join(REPORTS, 'negative', name);
  fs.mkdirSync(directory, { recursive: true });
  const output = fs.openSync(path.join(directory, 'scanner.log'), 'w');
  const containerName = `ofp-zap-negative-${name}-${process.pid}`;
  let scan;
  try {
    // There is deliberately no app in this namespace, no ports and no network.
    scan = spawnSync('docker', ['run', '--rm', '--name', containerName,
      '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      IMAGE, 'zap-baseline.py', ...args],
    { stdio: ['ignore', output, output], timeout: 180_000, killSignal: 'SIGTERM' });
  } finally {
    fs.closeSync(output);
    spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore', timeout: 15_000 });
  }
  assert.ok(!scan.error, `${name}: scanner invocation itself timed out or was unavailable.`);
  assert.ok(Number.isInteger(scan.status), `${name}: scanner exit is missing.`);
  assert.throws(() => assess({ stage: 'scan', exit: scan.status, image: IMAGE, target: TARGET },
    null, null, { rules: {} }), /Scanner did not complete|coverage is missing/);
  const result = { scenario: name, status: 'inconclusive', scannerExit: scan.status,
    expected: true, reason: 'A real failed scanner process did not produce verified coverage.' };
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'summary.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Negative scan verification</title><h1>${name}: inconclusive</h1><p>Expected failure was rejected by the completion classifier. See result.json and scanner.log.</p></html>\n`);
  console.log(`Verified real scanner failure handling: ${name} (exit ${scan.status}).`);
}
