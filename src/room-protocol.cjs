const TRANSFER_CHUNK = 64 * 1024;
const ROOM_FEATURES = ['chat', 'files'];
const readFeatures = value => Array.isArray(value) ? ROOM_FEATURES.filter(feature => value.includes(feature)) : [];
const validId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

function validFilename(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\\/<>:"|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value) &&
    !/[. ]$/.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

function validChat(value) {
  return Boolean(value?.type === 'chat' && validId(value.id) && typeof value.text === 'string' && value.text.trim().length > 0 &&
    value.text.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text));
}

function validFileMessage(value) {
  if (!value || !validId(value.id)) return false;
  if (value.type === 'file-offer') return validFilename(value.name) && Number.isSafeInteger(value.size) && value.size >= 0;
  if (value.type === 'file-end') return typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
  return ['file-accept', 'file-reject', 'file-cancel', 'file-complete'].includes(value.type);
}

function safeExternalURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

module.exports = { TRANSFER_CHUNK, ROOM_FEATURES, readFeatures, validId, validFilename, validChat, validFileMessage, safeExternalURL };
