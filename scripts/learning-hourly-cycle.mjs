import { spawnSync } from 'node:child_process';

const steps = [
  ['collector', ['run', 'learning:collector']],
  ['reasoner', ['run', 'learning:reasoner']],
  ['paper-fill', ['run', 'learning:paper:fill']],
  ['portfolio-mark', ['run', 'learning:portfolio:mark']],
  ['outcomes', ['run', 'learning:outcomes']],
  ['watchdog', ['run', 'learning:watchdog']],
  ['report', ['run', 'learning:report']]
];

const results = [];
for (const [name, args] of steps) {
  const run = spawnSync('npm', args, { encoding: 'utf8', env: process.env });
  results.push({
    name,
    status: run.status,
    ok: run.status === 0,
    stdout: String(run.stdout || '').trim().slice(-4000),
    stderr: String(run.stderr || '').trim().slice(-4000)
  });
  if (name === 'collector' && run.status !== 0) break;
}

const ok = results.every(x => x.ok);
console.log(JSON.stringify({ ok, steps: results, execution_enabled: false }, null, 2));
if (!ok) process.exitCode = 1;
