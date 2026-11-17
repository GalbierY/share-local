const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseInvitation, makeInvitation, invitationArgument } = require('../src/invitations.cjs');

test('convite preserva IP privado e nomes com acentos, emoji e sinais', () => {
  const name = 'Cantinho 🐈 & café? #1';
  const link = makeInvitation('192.168.1.10', name);
  assert.ok(link.startsWith('share-local://join?'));
  assert.deepEqual(parseInvitation(link), { address: '192.168.1.10', name });
  assert.deepEqual(parseInvitation('share-local://join/?address=10.0.0.4'), { address: '10.0.0.4', name: 'Sala compartilhada' });
});

test('recusa convites com destinos externos, credenciais, comandos e endereços ambíguos', () => {
  const invalid = [null, '', 'https://evil.test', 'file:///C:/Windows', 'share-local://evil?address=10.0.0.4',
    'share-local://join?address=8.8.8.8', 'share-local://join?address=127.0.0.1', 'share-local://join?address=172.016.0.1',
    'share-local://join?address=192.168.1.999', 'share-local://user@join?address=10.0.0.4',
    'share-local://join:45878?address=10.0.0.4', 'share-local://join/evil?address=10.0.0.4',
    'share-local://join?address=10.0.0.4&address=192.168.1.2', 'share-local://join?address=10.0.0.4&command=calc.exe',
    'share-local://join?address=10.0.0.4#fragment', 'share-local://join?address=10.0.0.4&room=nome%0Aextra',
    'share-\nlocal://join?address=10.0.0.4',
    `share-local://join?address=10.0.0.4&room=${'x'.repeat(41)}`, 'x'.repeat(1025)];
  for (const value of invalid) assert.throws(() => parseInvitation(value), /convite não é válido/);
  assert.throws(() => makeInvitation('8.8.8.8', 'Sala'));
});

test('encontra o convite nos argumentos sem interpretar arquivos ou outros protocolos', () => {
  const link = makeInvitation('10.0.0.4', 'Sala');
  assert.equal(invitationArgument(['app.exe', '--smoke-test', link]), link);
  assert.equal(invitationArgument(['app.exe', '.', '--smoke-test']), undefined);
  assert.equal(invitationArgument(['app.exe', 'file:///teste', 'https://evil.test']), undefined);
});
