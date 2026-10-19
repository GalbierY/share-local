const os = require('node:os');
const TYPES = new Set(['offer', 'answer', 'candidate', 'stop']);

function validSignal(value) {
  if (!value || !TYPES.has(value.type) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)) return false;
  if (value.type === 'offer' || value.type === 'answer') {
    return Boolean(value.description?.type === value.type && typeof value.description.sdp === 'string' && value.description.sdp.length < 100000);
  }
  if (value.type === 'candidate') return Boolean(value.candidate && typeof value.candidate.candidate === 'string' && value.candidate.candidate.length < 4096);
  return true;
}

function localAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
}

function validAddress(address) {
  if (typeof address !== 'string') return false;
  const parts = address.split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255) &&
    (parts[0] === '10' || (parts[0] === '192' && parts[1] === '168') || (parts[0] === '172' && +parts[1] >= 16 && +parts[1] <= 31));
}
module.exports = { validSignal, localAddresses, validAddress };
