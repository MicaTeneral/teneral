import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lsp, readProfiles, type LspProfile } from '../../body/lsp';

function fixture(): { root: string; path: string; profile: LspProfile } {
  const root = mkdtempSync(join(tmpdir(), 'teneral-lsp-'));
  const path = join(root, 'a.c'); writeFileSync(path, 'int value = 1;\n');
  const server = join(root, 'server.ts');
  writeFileSync(server, `
let buf=Buffer.alloc(0), opened='';
process.stdin.on('data',(chunk)=>{buf=Buffer.concat([buf,chunk]);for(;;){const e=buf.indexOf('\\r\\n\\r\\n');if(e<0)return;const m=/Content-Length: (\\d+)/i.exec(buf.subarray(0,e).toString());if(!m)throw Error('frame');const n=Number(m[1]);if(buf.length<e+4+n)return;const x=JSON.parse(buf.subarray(e+4,e+4+n).toString());buf=buf.subarray(e+4+n);
const send=(msg)=>{const b=Buffer.from(JSON.stringify({jsonrpc:'2.0',...msg}));process.stdout.write(Buffer.concat([Buffer.from('Content-Length: '+b.length+'\\r\\n\\r\\n'),b]));};
if(x.method==='initialize')send({id:x.id,result:{capabilities:{definitionProvider:true,referencesProvider:true,hoverProvider:true,documentSymbolProvider:true}}});
if(x.method==='textDocument/didOpen')opened=x.params.textDocument.uri;
if(x.method==='textDocument/definition'){send({id:x.id,result:[{uri:opened,range:{start:{line:0,character:0},end:{line:0,character:3}}},{uri:'file:///etc/passwd',range:{}}]});send({id:99999,result:'late'});}
if(x.method==='textDocument/references')send({id:x.id,result:Array.from({length:6},()=>({uri:opened,range:{}}))});
if(x.method==='textDocument/documentSymbol')send({id:x.id,result:Array.from({length:6},(_,i)=>({name:'s'+i}))});
if(x.method==='textDocument/hover')send({id:x.id,result:{contents:{kind:'plaintext',value:'int value'}}});
if(x.method==='shutdown')send({id:x.id,result:null});
}});`);
  return { root, path, profile: { command: process.execPath, args: [server], cwd: root } };
}

test('LSP validates locations, caps results and preserves explicit freshness', async () => {
  const f = fixture();
  const definition = await lsp({ profile: f.profile, operation: 'definition', path: 'a.c', text: 'int value = 1;\n', line: 0, character: 4 });
  expect(definition.status).toBe('result');
  expect((definition.result as unknown[]).length).toBe(1);
  expect(definition.rejectedLocations).toBe(1);
  expect(definition.freshness).toBe('unknown');
  const references = await lsp({ profile: f.profile, operation: 'references', path: 'a.c', text: 'int value = 1;\n', line: 0, character: 4, limit: 2 });
  expect((references.result as unknown[]).length).toBe(2); expect(references.truncated).toBe(true);
  const symbols = await lsp({ profile: f.profile, operation: 'symbols', path: 'a.c', text: 'int value = 1;\n', limit: 2 });
  expect((symbols.result as unknown[]).length).toBe(2); expect(symbols.truncated).toBe(true);
});

test('LSP separates empty semantic results and server errors', async () => {
  const f = fixture();
  const error = await lsp({ profile: { ...f.profile, args: ['/does/not/exist'] }, operation: 'hover', path: 'a.c', text: '', line: 0, character: 0, timeoutMs: 1000 });
  expect(error.status).toBe('server-error'); expect(error.freshness).toBe('unknown');
  const emptyRoot = mkdtempSync(join(tmpdir(), 'teneral-lsp-empty-'));
  const emptyPath = join(emptyRoot, 'a.c'); writeFileSync(emptyPath, '');
  const emptyServer = join(emptyRoot, 'server.ts');
  writeFileSync(emptyServer, `let b=Buffer.alloc(0);process.stdin.on('data',x=>{b=Buffer.concat([b,x]);let e;while((e=b.indexOf('\\r\\n\\r\\n'))>=0){const n=Number(/Content-Length: (\\d+)/i.exec(b.subarray(0,e).toString())?.[1]);if(b.length<e+4+n)return;const q=JSON.parse(b.subarray(e+4,e+4+n).toString());b=b.subarray(e+4+n);if(q.id!==undefined){const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='initialize'?{capabilities:{}}:[]}));process.stdout.write(Buffer.concat([Buffer.from('Content-Length: '+body.length+'\\r\\n\\r\\n'),body]));}}});`);
  const empty = await lsp({ profile: { command: process.execPath, args: [emptyServer], cwd: emptyRoot }, operation: 'definition', path: emptyPath, text: '', line: 0, character: 0 });
  expect(empty.status).toBe('unsupported');
});

test('LSP profiles are host configuration and reject driver execution', async () => {
  const f = fixture(); const file = join(f.root, 'profiles.json');
  writeFileSync(file, JSON.stringify({ profiles: { test: f.profile } }));
  expect(readProfiles(file).test?.cwd).toBe(f.root);
  const result = await lsp({ profile: { ...f.profile, args: ['--query-driver=/tmp/compiler'] }, operation: 'hover', path: 'a.c', text: '', line: 0, character: 0 });
  expect(result.status).toBe('server-error'); expect(String(result.error)).toContain('query-driver');
});
