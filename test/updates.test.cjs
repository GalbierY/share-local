const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startUpdates } = require('../src/updates.cjs');
const { parseRepository } = require('../scripts/setup-updates.cjs');

function fixture(overrides = {}) {
  const updater = new EventEmitter();
  const timeouts = [], intervals = [], events = [];
  let checks = 0, installs = 0, busy = false;
  updater.checkForUpdates = async () => { checks++; updater.emit('checking-for-update'); };
  updater.quitAndInstall = (silent, runAfter) => { assert.equal(silent, false); assert.equal(runAfter, true); installs++; };
  const controller = startUpdates({
    app: { isPackaged: true, getVersion: () => '0.2.0', ...overrides }, updater, configured: overrides.configured ?? true,
    emit: value => events.push(value), isBusy: () => busy,
    timers: { setTimeout: fn => { timeouts.push(fn); return fn; }, setInterval: fn => { intervals.push(fn); return fn; }, clearTimeout() {}, clearInterval() {} }
  });
  return { updater, controller, timeouts, intervals, events, setBusy: value => { busy = value; }, checks: () => checks, installs: () => installs };
}
test('não busca nem instala em desenvolvimento ou sem destino configurado', async () => {
  for (const options of [{ isPackaged: false }, { configured: false }]) {
    const f = fixture(options);
    await f.controller.check();
    assert.equal(f.checks(), 0);
    assert.equal(f.timeouts.length, 0);
    assert.equal(f.installs(), 0);
  }
});
test('baixa sozinho, aguarda sair da sala e instala uma única vez', async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.allowDowngrade, false);
  await f.timeouts[0]();
  assert.equal(f.checks(), 1);
  f.updater.emit('update-available', { version: '0.3.0' });
  f.updater.emit('download-progress', { percent: 42.9 });
  assert.equal(f.controller.state().percent, 42);
  f.setBusy(true);
  f.updater.emit('update-downloaded', { version: '0.3.0' });
  f.timeouts[1]();
  assert.equal(f.installs(), 0);
  assert.equal(f.controller.state().status, 'waiting');
  f.setBusy(false);
  f.intervals[1]();
  f.intervals[1]();
  assert.equal(f.installs(), 1);
  assert.equal(f.controller.state().status, 'installing');
});
test('erro de rede permite tentar novamente sem derrubar a sala', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => { throw new Error('offline'); };
  await f.controller.check();
  assert.equal(f.controller.state().status, 'error');
  assert.equal(f.installs(), 0);
  f.updater.checkForUpdates = async () => f.updater.emit('update-not-available');
  await f.controller.check();
  assert.equal(f.controller.state().status, 'current');
});
test('aceita somente URLs de repositórios GitHub, sem token ou endereço de terceiros', () => {
  assert.deepEqual(parseRepository('https://github.com/alguem/nosso-canto.git'), { provider: 'github', owner: 'alguem', repo: 'nosso-canto', releaseType: 'release' });
  for (const url of ['', 'http://github.com/a/b', 'https://evil.test/a/b', 'https://github.com/a/b/releases', 'https://token@github.com/a/b', 'https://github.com/a/..']) assert.throws(() => parseRepository(url));
});
