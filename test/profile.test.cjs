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

test('preserva a foto no perfil e permite voltar a um avatar sem manter a imagem', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'share-local-profile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'profile.json');
  const image = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'fixtures', 'avatar.png')).toString('base64')}`;
  const profile = { name: 'Pessoa', avatar: 'custom', image };
  assert.deepEqual(saveProfile(file, { ...profile, filename: 'C:/foto-pessoal.png' }), profile);
  assert.deepEqual(readProfile(file), profile);
  assert.throws(() => saveProfile(file, { ...profile, image: 'https://example.com/foto.png' }));
  assert.deepEqual(readProfile(file), profile);
  for (const avatar of ['mymelody', 'poporing']) {
    saveProfile(file, { name: 'Pessoa', avatar });
    assert.deepEqual(readProfile(file), { name: 'Pessoa', avatar });
    assert.equal(fs.readFileSync(file, 'utf8').includes('data:image'), false);
  }
});
