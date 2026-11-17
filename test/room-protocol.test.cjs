const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validChat, validFileMessage, validFilename, safeExternalURL, readFeatures } = require('../src/room-protocol.cjs');
const id = '12345678-1234-1234-1234-123456789abc';

test('chat aceita texto limitado e arquivos exigem nomes e metadados seguros', () => {
  assert.equal(validChat({ type: 'chat', id, text: 'Olá 🐈\nhttps://example.com' }), true);
  for (const text of ['', '   ', 'x'.repeat(2001), 'a\0b']) assert.equal(validChat({ type: 'chat', id, text }), false);
  assert.equal(validFileMessage({ type: 'file-offer', id, name: 'foto de férias.png', size: 0 }), true);
  assert.equal(validFileMessage({ type: 'file-end', id, sha256: 'f'.repeat(64) }), true);
  for (const name of ['../x.exe', 'pasta\\x.txt', 'CON', 'nul.txt', 'arquivo.', 'nome ', '<img>', 'x\0.txt', 'falso\u202Efdp.exe']) assert.equal(validFilename(name), false);
  for (const size of [-1, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '100']) assert.equal(validFileMessage({ type: 'file-offer', id, name: 'a.txt', size }), false);
  assert.equal(validFileMessage({ type: 'file-end', id, sha256: '../arquivo' }), false);
  assert.deepEqual(readFeatures(['files', 'chat', 'exec']), ['chat', 'files']);
  assert.deepEqual(readFeatures(undefined), []);
});

test('links externos só abrem HTTP ou HTTPS sem credenciais nem controles', () => {
  assert.equal(safeExternalURL('https://example.com/video?a=1&b=2'), true);
  for (const url of ['file:///C:/Windows', 'javascript:alert(1)', 'shell:AppsFolder', 'share-local://join', 'https://user:pass@example.com', 'https://example.com/\n--flag', null]) assert.equal(safeExternalURL(url), false);
});
