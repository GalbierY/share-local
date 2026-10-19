const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validSignal, validAddress } = require('../src/protocol.cjs');
const id = '12345678-1234-1234-1234-123456789abc';
test('só aceita endereços IPv4 privados válidos', () => {
  for (const ip of ['192.168.1.2', '10.0.0.4', '172.16.0.2', '172.31.255.254']) assert.equal(validAddress(ip), true);
  for (const ip of ['8.8.8.8', '127.0.0.1', '192.168.1.999', '172.32.0.1', 'localhost', '192.168.1.1/evil', null]) assert.equal(validAddress(ip), false);
});
test('valida mensagens e limita o tamanho antes de encaminhar ao WebRTC', () => {
  assert.equal(validSignal({ type: 'stop', id }), true);
  assert.equal(validSignal({ type: 'offer', id, description: { type: 'offer', sdp: 'v=0' } }), true);
  assert.equal(validSignal({ type: 'candidate', id, candidate: { candidate: 'candidate:1' } }), true);
  for (const msg of [null, {}, { type: 'eval', id }, { type: 'stop', id: '<script>' }, { type: 'offer', id, description: { type: 'answer', sdp: '' } }, { type: 'offer', id, description: { type: 'offer', sdp: 'x'.repeat(100000) } }]) assert.equal(validSignal(msg), false);
});
