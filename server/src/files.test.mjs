import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { answer, problem } from '../plugins/files/send-file.mjs';
import { MAX_FILE, dropImages, readFile, saveFile } from './images.ts';
import { readAs } from './projects.ts';

const project = mkdtempSync(join(tmpdir(), 'toto-files-'));
writeFileSync(`${project}/report.pdf`, 'pdf bytes');
mkdirSync(`${project}/out`);
writeFileSync(`${project}/out/log.txt`, 'a log');
writeFileSync(`${project}/empty`, '');
writeFileSync(`${project}/big`, Buffer.alloc(MAX_FILE + 1));
const outside = mkdtempSync(join(tmpdir(), 'toto-outside-'));
writeFileSync(`${outside}/secret`, 'secret');
symlinkSync(`${outside}/secret`, `${project}/link`);

test('the send_file tool turns away what cannot be sent, and says what is wrong', () => {
  assert.equal(problem('report.pdf', project), undefined);
  assert.equal(problem(`${project}/out/log.txt`, project), undefined);
  for (const [path, why] of [['nothing', /no file/], ['out', /not a file/], ['empty', /empty/], ['big', /10 MB/], ['link', /outside/], ['../x', /no file|outside/], [`${outside}/secret`, /outside/], ['', /Say which/], [5, /Say which/]]) assert.match(problem(path, project), why, String(path));
});

test('the tool server speaks enough MCP to be listed and called', () => {
  const run = (...msgs) => spawnSync('node', [new URL('../plugins/files/send-file.mjs', import.meta.url).pathname], { input: msgs.map((m) => JSON.stringify(m) + '\n').join(''), cwd: project, encoding: 'utf8' }).stdout.trim().split('\n').map((l) => JSON.parse(l));
  const [init, list, ok, bad] = run(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'send_file', arguments: { path: 'report.pdf' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_file', arguments: { path: 'link' } } },
  );
  assert.equal(init.result.serverInfo.name, 'toto-files');
  assert.equal(list.result.tools[0].name, 'send_file');
  assert.deepEqual([ok.result.isError, bad.result.isError], [false, true]);
  assert.match(ok.result.content[0].text, /Sent report.pdf/);
  assert.equal(answer({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
});

test('a file an agent sent is kept by reference, named plainly, and given back whole', () => {
  const root = mkdtempSync(join(tmpdir(), 'toto-data-'));
  const ref = saveFile('abcdef12', Buffer.from('pdf bytes'), '/home/x/../out/rep\u0007ort.PDF', root);
  assert.deepEqual({ ...ref, id: undefined }, { id: undefined, name: 'report.PDF', mime: 'application/pdf', bytes: 9 });
  assert.equal(readFile('abcdef12', ref.id, root).toString(), 'pdf bytes');
  assert.equal(readFile('abcdef12', '../../etc', root), undefined);
  assert.equal(saveFile('abcdef12', Buffer.alloc(0), 'a', root), undefined);
  assert.equal(saveFile('abcdef12', Buffer.alloc(MAX_FILE + 1), 'a', root), undefined);
  assert.equal(saveFile('../evil', Buffer.from('x'), 'a', root), undefined);
  dropImages('abcdef12', root);
  assert.equal(readFile('abcdef12', ref.id, root), undefined);
});

test('a file is read for the person in full, and a file that is too big is seen to be', async () => {
  assert.equal((await readAs(undefined, project, `${project}/report.pdf`, MAX_FILE)).toString(), 'pdf bytes');
  assert.equal((await readAs(undefined, project, `${project}/big`, MAX_FILE)).length, MAX_FILE + 1);
  assert.equal(await readAs(undefined, project, `${project}/nothing`, MAX_FILE), undefined);
});
