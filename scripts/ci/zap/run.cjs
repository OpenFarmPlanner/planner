const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const IMAGE = 'ghcr.io/zaproxy/zaproxy:2.17.0@sha256:c2d63bbb2d907a5c5257914fb20e26e969c92b25f265def7f89f08203f912882';
const TARGET = 'http://127.0.0.1:4173/';
const REPORTS = path.resolve(__dirname, '../../../reports/zap');
const INPUT = __dirname;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 600_000, ...options });
  if (result.error || result.status !== 0) throw new Error(`Docker operation failed (${result.status ?? 'unavailable'}).`);
  return result.stdout?.trim();
}

async function run() {
  fs.rmSync(REPORTS, { recursive: true, force: true });
  fs.mkdirSync(REPORTS, { recursive: true, mode: 0o777 });
  // ZAP's unprivileged container user writes only this disposable report folder.
  fs.chmodSync(REPORTS, 0o777);
  const targetName = `ofp-zap-target-${process.pid}`;
  const scannerName = `ofp-zap-scanner-${process.pid}`;
  let stage = 'startup';
  let status = 3;
  try {
    docker(['run', '--detach', '--name', targetName, '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--tmpfs', '/tmp:rw,nosuid,noexec,size=256m,mode=1777', 'ofp-zap-target:ci']);
    if (docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', targetName]) !== 'none') {
      throw new Error('Target network isolation was not established.');
    }
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      const probe = spawnSync('docker', ['exec', targetName, 'python', '-c',
        "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4173/api/schema/', timeout=5).read()"],
      { stdio: 'ignore', timeout: 7000 });
      if (probe.status === 0) { ready = true; break; }
      if (docker(['inspect', '--format', '{{.State.Running}}', targetName]) !== 'true') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('Disposable local instance did not become ready.');
    stage = 'scan';
    const output = fs.openSync(path.join(REPORTS, 'scanner.log'), 'w');
    try {
      const scan = spawnSync('docker', ['run', '--rm', '--name', scannerName,
        '--network', `container:${targetName}`, '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '-v', `${INPUT}:/zap/input:ro`, '-v', `${REPORTS}:/zap/wrk:rw`, IMAGE,
        'zap-baseline.py', '-t', TARGET, '-m', '1', '-T', '5', '--autooff',
        '--hook', '/zap/input/hooks.py', '-r', 'report.html', '-J', 'report.json',
        '-z', '-silent -config spider.processForm=false -config spider.postForm=false'],
      { stdio: ['ignore', output, output], timeout: 480_000, killSignal: 'SIGTERM' });
      status = scan.error ? 3 : (scan.status ?? 3);
    } finally {
      fs.closeSync(output);
    }
  } catch (error) {
    fs.writeFileSync(path.join(REPORTS, 'infrastructure.txt'), error.message + '\n');
  } finally {
    fs.writeFileSync(path.join(REPORTS, 'scan-status.json'), JSON.stringify({ stage, exit: status, image: IMAGE, target: TARGET }) + '\n');
    const logs = spawnSync('docker', ['logs', '--tail', '100', targetName], { encoding: 'utf8', timeout: 15_000 });
    fs.writeFileSync(path.join(REPORTS, 'target.log'), (logs.stdout ?? '') + (logs.stderr ?? ''));
    for (const name of [scannerName, targetName]) {
      spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', timeout: 15_000 });
    }
  }
  // Classification is a separate always-run step, including after startup failure.
  if (![0, 2].includes(status)) process.exitCode = 1;
}

if (require.main === module) run().catch(() => { process.exitCode = 1; });
module.exports = { IMAGE, TARGET, REPORTS };
