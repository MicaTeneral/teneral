import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publication } from '../../keeper/publication';
import { commitAll, writeFiles } from '../helpers';
import { git } from '../../immune/gates';

function setup(): string {
  const root = mkdtempSync(join(tmpdir(), 'teneral-publication-'));
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-b', 'main');
  writeFiles(root, { 'README.md': 'test\n' });
  commitAll(root, 'base');
  git(root, 'remote', 'add', 'origin', 'https://example.invalid/teneral.git');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'checkout', '-b', 'lineage/local');
  return root;
}

test('publication status is local, shows a pending lineage, and needs no credential', () => {
  const candidate = setup();
  expect(publication({ candidate }).pending).toBe(false);
  expect(publication({ candidate }, { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.bad.insteadOf', GIT_CONFIG_VALUE_0: 'https://' }).pending).toBe(false);
  writeFiles(candidate, { 'body/new.ts': 'export const ready = true;\n' });
  commitAll(candidate, 'ready');
  const state = publication({ candidate }, {});
  expect(state.pending).toBe(true);
  expect(state.commit).toBe(git(candidate, 'rev-parse', '--short=12', 'HEAD'));
  git(candidate, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  expect(publication({ candidate }, {})).toEqual({ commit: state.commit, pending: false });
});

test('missing checkout or species ref is not reported as publication-ready', () => {
  const root = mkdtempSync(join(tmpdir(), 'teneral-publication-empty-'));
  expect(publication({ candidate: join(root, 'absent') })).toEqual({ commit: null, pending: false });
  const candidate = setup();
  git(candidate, 'update-ref', '-d', 'refs/remotes/origin/main');
  expect(publication({ candidate }, {})).toEqual({ commit: null, pending: false });
});
