import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bash = Bun.which('bash');
const one = join(import.meta.dir, '..', '..', 'one');

/** Run the real install script with only its host probes and Docker replaced. */
async function run(docker: string, snap = false): Promise<{ code: number; out: string; calls: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'teneral-one-'));
  const script = join(dir, 'one');
  await Bun.write(script, await Bun.file(one).text());
  await Bun.$`chmod +x ${script}`.quiet();
  const bin = join(dir, 'bin');
  const calls = join(dir, 'calls');
  await Bun.$`mkdir -p ${bin}`.quiet();
  writeFileSync(join(dir, '.env'), 'TENERAL_MODEL=test\n');
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >>'${calls}'\n${docker}\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'uname'), `#!/usr/bin/env bash\nprintf '%s\\n' '${snap ? 'Linux' : 'Darwin'}'\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'readlink'), `#!/usr/bin/env bash\nprintf "%s\\n" "${snap ? '/snap/docker/current/bin/docker' : '/usr/bin/docker'}"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'mktemp'), `#!/usr/bin/env bash\nprintf '%s\\n' '${dir}/build-output'\n`, { mode: 0o755 });
  const child = Bun.spawn([bash!, script, 'run', 'true'], {
    cwd: dir,
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: dir },
    stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out: stdout + stderr, calls: await Bun.file(calls).text().catch(() => '') };
}

test.skipIf(bash === null)('one warns before running a snap Docker without weakening the container flags', async () => {
  const r = await run('exit 0', true);
  expect(r.code).toBe(0);
  expect(r.out).toContain('Snap Docker');
  expect(r.out).toContain('AppArmor');
  expect(r.out).toContain('https://github.com/RayforceDB/teneral/issues/11');
  expect(r.calls).toContain('--security-opt no-new-privileges');
});

test.skipIf(bash === null)('one does not claim that a non-snap Docker is affected by the snap issue', async () => {
  const r = await run('exit 0');
  expect(r.code).toBe(0);
  expect(r.out).not.toContain('Snap Docker');
  expect(r.calls).toContain('--security-opt no-new-privileges');
});

// --- ./one reset ---

const sh = (cwd: string, ...cmd: string[]): string => {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@localhost', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@localhost' } });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

/** An install as a life leaves it: cloned from a species that has since moved on, with a journal, a soul, a lineage and the credentials it was given. */
async function lived(): Promise<{ dir: string; bin: string; old: string; newest: string }> {
  const base = mkdtempSync(join(tmpdir(), 'teneral-reset-'));
  const species = join(base, 'species');
  await Bun.$`mkdir -p ${species}`.quiet();
  sh(species, 'git', 'init', '-q', '-b', 'main');
  await Bun.write(join(species, 'one'), await Bun.file(one).text());
  await Bun.$`chmod +x ${join(species, 'one')}`.quiet();
  writeFileSync(join(species, '.gitignore'), 'node_modules\nsoul\nmemory\ninbox\n.teneral\n.env\n');
  writeFileSync(join(species, 'code.txt'), 'old\n');
  sh(species, 'git', 'add', '-A');
  sh(species, 'git', 'commit', '-q', '-m', 'seed');
  const dir = join(base, 'morrow');
  sh(base, 'git', 'clone', '-q', species, dir);
  const old = sh(dir, 'git', 'rev-parse', 'HEAD');
  // The species moves on after the clone.
  writeFileSync(join(species, 'code.txt'), 'new\n');
  sh(species, 'git', 'commit', '-q', '-am', 'species: newer code');
  const newest = sh(species, 'git', 'rev-parse', 'HEAD');
  // The life: its own commits on the lineage, in a workspace; what it remembers; what it was given.
  writeFileSync(join(dir, '.env'), 'TENERAL_MODEL=test\nSECRET_KEY=provider-key\n');
  sh(dir, 'git', 'worktree', 'add', '-q', '-b', 'lineage/local', join(dir, '.teneral', 'candidate'), 'HEAD');
  sh(dir, 'git', 'worktree', 'add', '-q', '--detach', join(dir, '.teneral', 'live'), 'HEAD');
  writeFileSync(join(dir, '.teneral', 'candidate', 'mine.txt'), 'a mutation\n');
  sh(join(dir, '.teneral', 'candidate'), 'git', 'add', '-A');
  sh(join(dir, '.teneral', 'candidate'), 'git', 'commit', '-q', '-m', 'lineage: my own change');
  for (const d of ['memory', 'soul', 'inbox', '.teneral/auth', '.teneral/offers', '.teneral/owner', '.teneral/organs', '.teneral/candidate/.teneral']) await Bun.$`mkdir -p ${join(dir, d)}`.quiet();
  writeFileSync(join(dir, 'memory', 'journal.jsonl'), '{"type":"stimulus"}\n');
  writeFileSync(join(dir, 'soul', 'SOUL.md'), '# Morrow\n');
  writeFileSync(join(dir, '.teneral', 'id'), 'the-install-id\n');
  writeFileSync(join(dir, '.teneral', 'state.json'), `{"current":"${old}","previous":null}\n`);
  writeFileSync(join(dir, '.teneral', 'auth', 'github-token'), 'ghp_token\n', { mode: 0o600 });
  writeFileSync(join(dir, '.teneral', 'auth', 'offer-key'), 'signing key\n', { mode: 0o600 });
  writeFileSync(join(dir, '.teneral', 'organs', 'cached'), 'a library\n');
  writeFileSync(join(dir, '.teneral', 'candidate', '.teneral', 'zulip.json'), '{"api_key":"zulip-key"}\n', { mode: 0o600 });
  writeFileSync(join(dir, '.teneral', 'candidate', '.teneral', 'notes.md'), 'not a credential\n', { mode: 0o644 });
  const bin = join(base, 'bin');
  await Bun.$`mkdir -p ${bin}`.quiet();
  // No container exists: every question about one is answered with nothing.
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >>'${join(base, 'calls')}'\ncase "$1 $2" in "container inspect") exit 1 ;; esac\nexit 0\n`, { mode: 0o755 });
  return { dir, bin, old, newest };
}

async function reset(l: { dir: string; bin: string }, ...args: string[]): Promise<{ code: number; out: string }> {
  const child = Bun.spawn([bash!, join(l.dir, 'one'), 'reset', ...args], { cwd: l.dir, env: { PATH: `${l.bin}:${process.env.PATH ?? ''}`, HOME: l.dir }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out: stdout + stderr };
}

test.skipIf(bash === null)('one reset moves a life aside and keeps what it was given: the newest code, no journal, no soul, the tokens where they were', async () => {
  const l = await lived();
  const { existsSync, readFileSync, readdirSync } = await import('node:fs');
  // Not at a terminal and not told to: nothing is touched.
  const asked = await reset(l);
  expect(asked.code).toBe(1);
  expect(asked.out).toContain('./one reset --yes does it without asking. Nothing was changed.');
  expect(existsSync(join(l.dir, 'memory', 'journal.jsonl'))).toBe(true);

  const r = await reset(l, '--yes');
  expect(r.out).toContain('./one up begins the new life.');
  expect(r.code).toBe(0);
  // The code is the species' newest.
  expect(sh(l.dir, 'git', 'rev-parse', 'HEAD')).toBe(l.newest);
  expect(readFileSync(join(l.dir, 'code.txt'), 'utf8')).toBe('new\n');
  // What a life made is gone from where a life is lived.
  for (const gone of ['memory', 'soul', 'inbox', '.teneral/state.json', '.teneral/candidate', '.teneral/live', '.teneral/offers', '.teneral/owner']) expect(`${gone}:${existsSync(join(l.dir, gone))}`).toBe(`${gone}:false`);
  expect(sh(l.dir, 'git', 'worktree', 'list').split('\n')).toHaveLength(1);
  expect(sh(l.dir, 'git', 'branch', '--list', 'lineage/local')).toBe('');
  // And is all in the past, the lineage's commits with it.
  const [stamp] = readdirSync(join(l.dir, '.teneral', 'past'));
  const past = join(l.dir, '.teneral', 'past', stamp!);
  expect(readFileSync(join(past, 'memory', 'journal.jsonl'), 'utf8')).toBe('{"type":"stimulus"}\n');
  expect(readFileSync(join(past, 'soul', 'SOUL.md'), 'utf8')).toBe('# Morrow\n');
  expect(existsSync(join(past, 'teneral', 'candidate', 'mine.txt'))).toBe(true);
  expect(existsSync(join(past, 'teneral', 'state.json'))).toBe(true);
  expect(sh(l.dir, 'git', 'log', '-1', '--format=%s', `past/${stamp}`)).toBe('lineage: my own change');
  // What it was given stays: the provider, the sign-ins, the id, the cache, and the credentials for its services.
  expect(readFileSync(join(l.dir, '.env'), 'utf8')).toContain('SECRET_KEY=provider-key');
  expect(readFileSync(join(l.dir, '.teneral', 'auth', 'github-token'), 'utf8')).toBe('ghp_token\n');
  expect(readFileSync(join(l.dir, '.teneral', 'auth', 'offer-key'), 'utf8')).toBe('signing key\n');
  expect(readFileSync(join(l.dir, '.teneral', 'id'), 'utf8')).toBe('the-install-id\n');
  expect(existsSync(join(l.dir, '.teneral', 'organs', 'cached'))).toBe(true);
  expect(readdirSync(join(l.dir, '.teneral', 'kept'))).toEqual(['zulip.json']);
  expect(readFileSync(join(l.dir, '.teneral', 'kept', 'zulip.json'), 'utf8')).toBe('{"api_key":"zulip-key"}\n');
});

test.skipIf(bash === null)('one reset refuses before it moves anything when the code cannot become the newest, and --keep-code leaves the code alone', async () => {
  const l = await lived();
  const { existsSync } = await import('node:fs');
  writeFileSync(join(l.dir, 'code.txt'), 'edited by hand\n');
  const dirty = await reset(l, '--yes');
  expect(dirty.code).toBe(1);
  expect(dirty.out).toContain('changes that are not committed');
  expect(dirty.out).toContain('Nothing was changed.');
  expect(existsSync(join(l.dir, 'memory', 'journal.jsonl'))).toBe(true);
  expect(existsSync(join(l.dir, '.teneral', 'past'))).toBe(false);

  const kept = await reset(l, '--yes', '--keep-code');
  expect(kept.code).toBe(0);
  expect(kept.out).toContain('the code stays as it is');
  expect(sh(l.dir, 'git', 'rev-parse', 'HEAD')).toBe(l.old);
  expect(existsSync(join(l.dir, 'memory'))).toBe(false);
  expect((await reset(l, '--now')).code).toBe(2);
});
