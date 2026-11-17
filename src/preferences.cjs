const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = { volume: 100, shareAudio: true, quality: 'auto', notifications: true, minimizeToOverlay: true, overlayOpacity: 0.92, overlaySide: 'right' };
function validPreference(key, value) {
  if (['shareAudio', 'notifications', 'minimizeToOverlay'].includes(key)) return typeof value === 'boolean';
  if (key === 'volume') return Number.isInteger(value) && value >= 0 && value <= 100;
  if (key === 'quality') return ['auto', 'economy', 'sharp'].includes(value);
  if (key === 'overlayOpacity') return typeof value === 'number' && value >= 0.8 && value <= 1;
  if (key === 'overlaySide') return ['left', 'right'].includes(value);
  if (key === 'window') return value && typeof value === 'object' && !Array.isArray(value) && ['x', 'y', 'width', 'height'].every(k => Number.isInteger(value[k]) && Math.abs(value[k]) <= 32768) && value.width >= 760 && value.height >= 600;
  return false;
}
function readPreferences(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(value || {}).filter(([key, item]) => validPreference(key, item))) };
  } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return { ...DEFAULTS }; throw error; }
}
function savePreferences(file, current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([key, value]) => !validPreference(key, value))) throw new Error('Preferência inválida.');
  const result = { ...current, ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(result) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return result;
}
module.exports = { readPreferences, savePreferences };
