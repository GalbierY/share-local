const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProfile, saveProfile } = require('../src/profile.cjs');

test('salva somente nome e avatar e recupera o perfil após abrir de novo', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'share-local-profile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'profile.json');
  assert.equal(readProfile(file), null);
  assert.deepEqual(saveProfile(file, { name: ' Ygor ', avatar: 'emma', ignored: 'não salvar' }), { name: 'Ygor', avatar: 'emma' });
  assert.deepEqual(readProfile(file), { name: 'Ygor', avatar: 'emma' });
  saveProfile(file, { name: 'João', avatar: 'priya' });
  assert.deepEqual(readProfile(file), { name: 'João', avatar: 'priya' });
  assert.throws(() => saveProfile(file, { name: '', avatar: 'zahir' }));
  assert.deepEqual(readProfile(file), { name: 'João', avatar: 'priya' });
  fs.writeFileSync(file, '{arquivo incompleto');
  assert.equal(readProfile(file), null);
  fs.writeFileSync(file, JSON.stringify({ name: 'Nome', avatar: '../arquivo' }));
  assert.equal(readProfile(file), null);
});
