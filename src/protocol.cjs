const os = require('node:os');
const TYPES = new Set(['offer', 'answer', 'candidate', 'stop', 'pause']);
const AVATARS = new Set(['zahir', 'emma', 'priya', 'mymelody', 'poporing']);
const LEGACY_AVATARS = new Set(['zahir', 'emma', 'priya']);

function validAvatarImage(value) {
  if (typeof value !== 'string' || value.length > 90000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const encoded = value.slice(22), png = Buffer.from(encoded, 'base64');
  return png.length >= 45 && png.toString('base64') === encoded &&
    png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && png.readUInt32BE(8) === 13 &&
    png.toString('ascii', 12, 16) === 'IHDR' && png.readUInt32BE(16) === 128 && png.readUInt32BE(20) === 128 &&
    png.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
}

function validProfile(value) {
  return Boolean(value && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 32 &&
    !/[\u0000-\u001f\u007f]/.test(value.name) &&
    (value.avatar === 'custom' ? validAvatarImage(value.image) : AVATARS.has(value.avatar) && value.image === undefined));
}

function copyProfile(value) {
  return { name: value.name.trim(), avatar: value.avatar, ...(value.avatar === 'custom' ? { image: value.image } : {}) };
}

function profileForPeer(value, features) {
  return features.includes('profile-images') ? copyProfile(value) :
    { name: value.name.trim(), avatar: LEGACY_AVATARS.has(value.avatar) ? value.avatar : 'zahir' };
}

function validSignal(value) {
  if (!value || !TYPES.has(value.type) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)) return false;
  if (value.channel !== undefined && value.channel !== 'room') return false;
  if (value.type === 'pause') return typeof value.paused === 'boolean' && value.channel === undefined;
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
  return parts.length === 4 && parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255) &&
    (parts[0] === '10' || (parts[0] === '192' && parts[1] === '168') || (parts[0] === '172' && +parts[1] >= 16 && +parts[1] <= 31));
}
module.exports = { validSignal, localAddresses, validAddress, validProfile, copyProfile, profileForPeer };
