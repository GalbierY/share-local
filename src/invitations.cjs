const { validAddress } = require('./protocol.cjs');

function parseInvitation(value) {
  const invalid = () => Object.assign(new Error('Este convite não é válido. Peça um novo convite ou informe o IP da sala.'), { code: 'INVALID_ADDRESS' });
  if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) throw invalid();
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  const address = url.searchParams.get('address');
  const name = url.searchParams.get('room') || 'Sala compartilhada';
  if (url.protocol !== 'share-local:' || url.hostname !== 'join' || url.port || url.username || url.password || url.hash ||
    !['', '/'].includes(url.pathname) || !validAddress(address) || name.length > 40 || !name.trim() ||
    /[\u0000-\u001f\u007f]/.test(name) || url.searchParams.getAll('address').length !== 1 || url.searchParams.getAll('room').length > 1 ||
    [...url.searchParams.keys()].some(key => !['address', 'room'].includes(key))) throw invalid();
  return { address, name: name.trim() };
}

function makeInvitation(address, name) {
  const url = new URL('share-local://join');
  url.searchParams.set('address', address);
  url.searchParams.set('room', name);
  parseInvitation(url.href);
  return url.href;
}

function invitationArgument(args) {
  return args.find(arg => /^share-local:/i.test(arg));
}

module.exports = { parseInvitation, makeInvitation, invitationArgument };
