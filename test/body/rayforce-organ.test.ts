import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseOrgans } from '../../kernel/organs';
test('Rayforce release pin parses and exposes runnable executable when organs prepared', async () => {
 expect(() => parseOrgans(readFileSync('body/organs.json','utf8'))).not.toThrow();
 // Ordinary tests need no external cache; the organ gate prepares this for gates.
 if (!process.env.TENERAL_ORGANS) return;
 const p = Bun.spawn([join(process.env.TENERAL_ORGANS,'rayforce','rayforce'),'--help'],{stdout:'pipe',stderr:'pipe'});
 const [out,err,exit] = await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 expect(exit).toBe(0); expect(out+err).toContain('rayforce');
});
