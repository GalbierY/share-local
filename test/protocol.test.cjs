const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validSignal, validAddress, validProfile, profileForPeer } = require('../src/protocol.cjs');
const image = `data:image/png;base64,${require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'avatar.png')).toString('base64')}`;
const id = '12345678-1234-1234-1234-123456789abc';
test('só aceita endereços IPv4 privados válidos', () => {
  for (const ip of ['192.168.1.2', '10.0.0.4', '172.16.0.2', '172.31.255.254']) assert.equal(validAddress(ip), true);
  for (const ip of ['8.8.8.8', '127.0.0.1', '192.168.1.999', '172.32.0.1', '172.016.0.1', '192.168.001.2', '10.0.000.1', 'localhost', '192.168.1.1/evil', null]) assert.equal(validAddress(ip), false);
});

test('perfis aceitam somente nomes curtos e os avatares locais', () => {
  assert.equal(validProfile({ name: 'Ygor', avatar: 'emma' }), true);
  assert.equal(validProfile({ name: 'João 🐈', avatar: 'priya' }), true);
  for (const avatar of ['mymelody', 'poporing']) assert.equal(validProfile({ name: 'Ygor', avatar }), true);
  for (const value of [null, {}, { name: ' ', avatar: 'zahir' }, { name: 'x'.repeat(33), avatar: 'zahir' },
    { name: 'nome\nextra', avatar: 'zahir' }, { name: 'nome', avatar: '../../arquivo' }, { name: 'nome', avatar: 'https://evil.test/avatar' }]) assert.equal(validProfile(value), false);
});
test('foto de perfil aceita apenas PNG limitado a 128 pixels, sem URLs externas ou SVG', () => {
  assert.equal(validProfile({ name: 'Pessoa', avatar: 'custom', image }), true);
  const oversized = Buffer.from(image.slice(22), 'base64');
  oversized.writeUInt32BE(4096, 16);
  for (const photo of [undefined, '', 'https://example.com/foto.png', 'file:///C:/foto.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    image + 'AAAA', image.replace('base64,', 'base64,\n'), 'data:image/png;base64,' + 'a'.repeat(90000),
    'data:image/png;base64,' + oversized.toString('base64')]) assert.equal(validProfile({ name: 'Pessoa', avatar: 'custom', image: photo }), false);
  assert.equal(validProfile({ name: 'Pessoa', avatar: 'emma', image }), false);
});
test('mantém perfis compatíveis com versões antigas sem enviar a imagem', () => {
  for (const avatar of ['zahir', 'emma', 'priya', 'mymelody', 'poporing', 'custom']) {
    const profile = { name: ' Pessoa ', avatar, ...(avatar === 'custom' ? { image } : {}) };
    const legacy = profileForPeer(profile, []);
    assert.deepEqual(legacy, { name: 'Pessoa', avatar: ['zahir', 'emma', 'priya'].includes(avatar) ? avatar : 'zahir' });
    assert.deepEqual(profileForPeer(profile, ['profile-images']), { ...profile, name: 'Pessoa' });
    assert.ok(Buffer.byteLength(JSON.stringify({ type: 'join-request', profile: legacy, fullProfile: profile })) < 128 * 1024);
  }
});
test('valida mensagens e limita o tamanho antes de encaminhar ao WebRTC', () => {
  assert.equal(validSignal({ type: 'stop', id }), true);
  assert.equal(validSignal({ type: 'pause', id, paused: true }), true);
  assert.equal(validSignal({ type: 'pause', id, paused: 'true' }), false);
  assert.equal(validSignal({ type: 'stop', id, channel: 'unknown' }), false);
  assert.equal(validSignal({ type: 'offer', id, description: { type: 'offer', sdp: 'v=0' } }), true);
  assert.equal(validSignal({ type: 'candidate', id, candidate: { candidate: 'candidate:1' } }), true);
  for (const msg of [null, {}, { type: 'eval', id }, { type: 'stop', id: '<script>' }, { type: 'offer', id, description: { type: 'answer', sdp: '' } }, { type: 'offer', id, description: { type: 'offer', sdp: 'x'.repeat(100000) } }]) assert.equal(validSignal(msg), false);
});
