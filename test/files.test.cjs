const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createFileTransfers, commitReceivedFile } = require('../src/files.cjs');
const { WebSocketServer, WebSocket } = require('ws');
const { once } = require('node:events');

async function waitFor(predicate) {
  for (let i = 0; i < 250; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Transferência não chegou ao estado esperado.');
}
async function fixture(t, content = randomBytes(512 * 1024), options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'share-local-files-'));
  const source = path.join(directory, 'origem.bin'), target = path.join(directory, 'destino.bin');
  await fs.writeFile(source, content);
  const leftEvents = [], rightEvents = [], messages = [], errors = [];
  let left, right, first = true;
  const flow = { pause() {}, resume() {} };
  const deliver = (to, message) => { Promise.resolve(to.receive(message)).catch(error => errors.push(error)); };
  left = createFileTransfers({ chooseFile: options.chooseFile || (async () => source), chooseDestination: async () => undefined,
    isConnected: () => true, emit: state => leftEvents.push(state), send: async message => {
      if (Buffer.isBuffer(message)) {
        right.receiveChunk(message, flow);
        if (first) { first = false; await options.onFirstChunk?.({ left, right, target, source }); }
      } else {
        messages.push(message);
        deliver(right, options.badHash && message.type === 'file-end' ? { ...message, sha256: '0'.repeat(64) } : message);
      }
    } });
  right = createFileTransfers({ chooseFile: async () => undefined, chooseDestination: options.chooseDestination || (async () => target),
    isConnected: () => true, emit: state => rightEvents.push(state), send: async message => { messages.push(message); deliver(left, message); } });
  t.after(async () => { await Promise.all([left.reset(), right.reset()]); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, source, target, content, left, right, leftEvents, rightEvents, messages, errors };
}

test('envia arquivo em blocos e confirma conteúdo, tamanho e integridade', { timeout: 8000 }, async t => {
  const f = await fixture(t);
  t.after(() => { if (!f.rightEvents.some(event => event.status === 'done')) console.error({ left: f.leftEvents.slice(-4), right: f.rightEvents.slice(-4), errors: f.errors }); });
  await f.left.offer();
  const offer = f.rightEvents.find(event => event.status === 'offered');
  assert.ok(offer);
  assert.equal(await fs.stat(f.target).catch(() => null), null);
  await f.right.respond({ id: offer.id, accept: true });
  await waitFor(() => f.leftEvents.some(event => event.status === 'done') && f.rightEvents.some(event => event.status === 'done'));
  assert.deepEqual(await fs.readFile(f.target), f.content);
  assert.equal(f.rightEvents.at(-1).bytes, f.content.length);
  assert.equal((await fs.readdir(f.directory)).some(name => name.endsWith('.part')), false);
  assert.equal(JSON.stringify(f.messages).includes(f.directory.replace(/\\/g, '\\\\')), false);
  assert.deepEqual(f.errors, []);
});

test('envia arquivo vazio e permite recusar sem criar o destino', { timeout: 8000 }, async t => {
  const f = await fixture(t, Buffer.alloc(0));
  await f.left.offer();
  let offer = f.rightEvents.at(-1);
  await f.right.respond({ id: offer.id, accept: false });
  await waitFor(() => f.leftEvents.some(event => event.status === 'declined'));
  assert.equal(await fs.stat(f.target).catch(() => null), null);
  await f.left.offer();
  offer = f.rightEvents.at(-1);
  await f.right.respond({ id: offer.id, accept: true });
  await waitFor(() => f.rightEvents.some(event => event.status === 'done'));
  assert.equal((await fs.stat(f.target)).size, 0);
});

test('cancelamento e checksum incorreto removem somente o arquivo parcial', { timeout: 8000 }, async t => {
  const cancelled = await fixture(t, randomBytes(2 * 1024 * 1024), { onFirstChunk: async ({ right }) => {
    await right.cancel(cancelled.rightEvents.find(event => event.status === 'offered').id);
  } });
  await cancelled.left.offer();
  await cancelled.right.respond({ id: cancelled.rightEvents.at(-1).id, accept: true });
  await waitFor(() => cancelled.leftEvents.some(event => event.status === 'cancelled'));
  assert.equal(await fs.stat(cancelled.target).catch(() => null), null);
  await waitFor(async () => !(await fs.readdir(cancelled.directory)).some(name => name.endsWith('.part')));
  const broken = await fixture(t, Buffer.from('conteúdo íntegro'), { badHash: true });
  await broken.left.offer();
  await broken.right.respond({ id: broken.rightEvents.at(-1).id, accept: true });
  await waitFor(() => broken.rightEvents.some(event => event.status === 'error'));
  await waitFor(async () => !(await fs.readdir(broken.directory)).some(name => name.endsWith('.part')));
  assert.equal(await fs.stat(broken.target).catch(() => null), null);
});

test('preserva um destino criado durante a transferência e descarta escolhas de uma conexão antiga', { timeout: 8000 }, async t => {
  const original = Buffer.from('não sobrescrever');
  const f = await fixture(t, randomBytes(256 * 1024), { onFirstChunk: async ({ target }) => { await fs.writeFile(target, original); } });
  await f.left.offer();
  await f.right.respond({ id: f.rightEvents.at(-1).id, accept: true });
  await waitFor(() => f.rightEvents.some(event => event.status === 'error'));
  assert.deepEqual(await fs.readFile(f.target), original);
  let resolveChoice;
  const stale = await fixture(t, Buffer.from('antigo'), { chooseFile: () => new Promise(resolve => { resolveChoice = resolve; }) });
  const choosing = stale.left.offer();
  await stale.left.reset();
  resolveChoice(stale.source);
  await choosing;
  assert.equal(stale.messages.some(message => message.type === 'file-offer'), false);
});

test('gravação final usa cópia exclusiva quando o disco não permite links', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'share-local-commit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const partial = path.join(directory, 'a.part'), target = path.join(directory, 'final.txt');
  await fs.writeFile(partial, 'arquivo');
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('sem links'), { code: 'EPERM' }); });
  await commitReceivedFile(partial, target);
  assert.equal(await fs.readFile(target, 'utf8'), 'arquivo');
  await fs.writeFile(partial, 'novo');
  await assert.rejects(commitReceivedFile(partial, target), { code: 'EEXIST' });
  assert.equal(await fs.readFile(target, 'utf8'), 'arquivo');
});

test('um arquivo parcial preexistente nunca é removido nem sobrescrito', async t => {
  const f = await fixture(t, Buffer.from('conteúdo novo'));
  await f.left.offer();
  const id = f.rightEvents.at(-1).id;
  const partial = path.join(f.directory, `.share-local-${id}.part`);
  await fs.writeFile(partial, 'preservar');
  await f.right.respond({ id, accept: true });
  await waitFor(() => f.rightEvents.some(event => event.status === 'error'));
  assert.equal(await fs.readFile(partial, 'utf8'), 'preservar');
});

test('transfere por WebSocket real com controle de fluxo e confirmação', { timeout: 10000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'share-local-network-'));
  const source = path.join(directory, 'origem.bin'), target = path.join(directory, 'recebido.bin');
  const content = randomBytes(2 * 1024 * 1024);
  await fs.writeFile(source, content);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const accepted = once(server, 'connection');
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const [host] = await accepted;
  await once(client, 'open');
  const leftEvents = [], rightEvents = [];
  const sender = socket => message => new Promise((resolve, reject) => socket.send(Buffer.isBuffer(message) ? message : JSON.stringify(message), error => error ? reject(error) : resolve()));
  const left = createFileTransfers({ chooseFile: async () => source, chooseDestination: async () => undefined, isConnected: () => true, send: sender(client), emit: value => leftEvents.push(value) });
  const right = createFileTransfers({ chooseFile: async () => undefined, chooseDestination: async () => target, isConnected: () => true, send: sender(host), emit: value => rightEvents.push(value) });
  t.after(async () => {
    await Promise.all([left.reset(), right.reset()]); client.terminate(); host.terminate();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  client.on('message', (data, binary) => binary ? left.receiveChunk(data, client) : left.receive(JSON.parse(data)));
  host.on('message', (data, binary) => binary ? right.receiveChunk(data, host) : right.receive(JSON.parse(data)));
  await left.offer();
  await waitFor(() => rightEvents.some(event => event.status === 'offered'));
  await right.respond({ id: rightEvents[0].id, accept: true });
  await waitFor(() => leftEvents.some(event => event.status === 'done') && rightEvents.some(event => event.status === 'done'));
  assert.deepEqual(await fs.readFile(target), content);
});

test('recusa alterações do arquivo antes ou durante a transmissão', { timeout: 8000 }, async t => {
  const before = await fixture(t, Buffer.from('original'));
  await before.left.offer();
  await fs.writeFile(before.source, 'conteúdo alterado');
  await before.right.respond({ id: before.rightEvents.at(-1).id, accept: true });
  await waitFor(() => before.leftEvents.some(event => event.status === 'error'));
  assert.equal(await fs.stat(before.target).catch(() => null), null);
  const during = await fixture(t, randomBytes(256 * 1024), { onFirstChunk: async ({ source }) => fs.appendFile(source, 'alterado') });
  await during.left.offer();
  await during.right.respond({ id: during.rightEvents.at(-1).id, accept: true });
  await waitFor(() => during.leftEvents.some(event => event.status === 'error'));
  assert.equal(await fs.stat(during.target).catch(() => null), null);
});

test('um cancelamento antigo não envia comandos para uma nova conexão', async t => {
  const f = await fixture(t);
  await f.left.offer();
  const cancellation = f.left.cancel(f.rightEvents.at(-1).id);
  await f.left.reset();
  await cancellation;
  assert.equal(f.messages.some(message => message.type === 'file-cancel'), false);
});

test('destinos existentes permanecem intactos e podem ser escolhidos novamente', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'preservar');
  await f.left.offer();
  await f.right.respond({ id: f.rightEvents.at(-1).id, accept: true });
  assert.equal(f.rightEvents.at(-1).status, 'offered');
  assert.match(f.rightEvents.at(-1).message, /Já existe/);
  assert.equal(await fs.readFile(f.target, 'utf8'), 'preservar');
});

test('uma escolha de destino antiga não grava depois de sair da conexão', async t => {
  let choose;
  const f = await fixture(t, Buffer.from('privado'), { chooseDestination: () => new Promise(resolve => { choose = resolve; }) });
  await f.left.offer();
  const response = f.right.respond({ id: f.rightEvents.at(-1).id, accept: true });
  await f.right.reset();
  choose(f.target);
  await response;
  assert.equal(await fs.stat(f.target).catch(() => null), null);
  assert.equal(f.messages.some(message => message.type === 'file-accept'), false);
  assert.equal((await fs.readdir(f.directory)).some(name => name.endsWith('.part')), false);
});
