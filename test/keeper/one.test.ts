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
