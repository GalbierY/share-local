const fs = require('node:fs');
const path = require('node:path');
const { validProfile } = require('./protocol.cjs');

function readProfile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validProfile(value) ? { name: value.name.trim(), avatar: value.avatar } : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function saveProfile(file, value) {
  if (!validProfile(value)) throw new Error('Informe um nome de até 32 caracteres e escolha um dos três avatares.');
  const profile = { name: value.name.trim(), avatar: value.avatar };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(profile) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return profile;
}

module.exports = { readProfile, saveProfile };
