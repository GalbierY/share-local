let secureRoom, secureReady = false, secureSession;
const secureCandidates = new Map();
function showSecureState(text) { $('secure-status').textContent = text; updateRoomTools(); }
function closeSecureRoom() {
  const state = secureRoom; secureRoom = undefined; secureReady = false;
  secureCandidates.clear();
  if (state) {
    action('secure-ready', { sessionId: state.sessionId, ready: false }).catch(() => {});
    clearTimeout(state.retryTimer);
    for (const request of state.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Canal protegido encerrado.')); }
    state.channel?.close(); state.pc.close();
  }
  showSecureState('Conversa e arquivos aguardando conexão');
}
async function markSecureReady(state) {
  if (secureRoom !== state || state.channel?.readyState !== 'open') return;
  const fingerprints = [state.pc.localDescription, state.pc.remoteDescription].map(description => description.sdp.match(/a=fingerprint:sha-256 (.+)/i)?.[1].trim());
  if (fingerprints.some(value => !value)) throw new Error('A conexão não apresentou uma identidade DTLS válida.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprints.sort().join('|')));
  if (secureRoom !== state) return;
  await action('secure-ready', { sessionId: state.sessionId, ready: true });
  if (secureRoom !== state) return;
  secureReady = true; state.retries = 0;
  const code = Array.from(new Uint8Array(hash).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join(' ');
  showSecureState(`🔒 Conversa e arquivos protegidos · ${code}`);
}
function bindSecureChannel(state, channel) {
  if (state.channel || channel.label !== 'share-local-secure-v1') { channel.close(); return; }
  state.channel = channel; channel.binaryType = 'arraybuffer';
  channel.onopen = () => markSecureReady(state).catch(error => { closeSecureRoom(); notice(error.message); });
  channel.onclose = () => {
    if (secureRoom !== state) return;
    secureReady = false; action('secure-ready', { sessionId: state.sessionId, ready: false }).catch(() => {});
    for (const request of state.pending.values()) { clearTimeout(request.timer); request.reject(new Error('O canal protegido foi interrompido.')); }
    state.pending.clear();
    showSecureState('Canal protegido interrompido. Reconecte à sala para continuar.');
  };
  channel.onerror = () => channel.close();
  let receiving = Promise.resolve(), queuedBytes = 0;
  channel.onmessage = event => {
    if (secureRoom !== state) return;
    const packet = event.data;
    if (typeof packet === 'string' && packet.length <= 128 * 1024) {
      try {
        const message = JSON.parse(packet);
        if (message.type === 'transport-ack') {
          const request = state.pending.get(message.sequence);
          if (request) { clearTimeout(request.timer); state.pending.delete(message.sequence); request.resolve(); }
          return;
        }
      } catch { channel.close(); return; }
    }
    const size = typeof packet === 'string' ? packet.length * 2 : packet.byteLength;
    if (!Number.isSafeInteger(size) || size > 256 * 1024 || queuedBytes + size > 1024 * 1024) { channel.close(); return; }
    queuedBytes += size;
    // Um bloco só é confirmado depois de gravado; o próximo aguarda essa confirmação.
    receiving = receiving.then(async () => {
      if (secureRoom !== state || channel.readyState !== 'open') return;
      if (packet instanceof ArrayBuffer) {
        if (packet.byteLength < 41 || packet.byteLength > 64 * 1024 + 40) throw new Error('Bloco de arquivo inválido.');
        const sequence = new DataView(packet).getUint32(0);
        await action('secure-packet', { sessionId: state.sessionId, packet: packet.slice(4) });
        if (secureRoom === state && channel.readyState === 'open') channel.send(JSON.stringify({ type: 'transport-ack', sequence }));
      } else if (typeof packet === 'string' && packet.length <= 128 * 1024) await action('secure-packet', { sessionId: state.sessionId, packet });
      else throw new Error('Mensagem protegida inválida.');
    }).catch(error => { if (secureRoom === state) { channel.close(); notice(error.message); } }).finally(() => { queuedBytes -= size; });
  };
}
function createSecureRoom(id) {
  const state = { id, sessionId: secureSession, pc: new RTCPeerConnection({ iceServers: [] }), sequence: 0, pending: new Map(), retries: 0 };
  secureRoom = state;
  state.signal = message => {
    if (secureRoom !== state || !connected) return Promise.resolve();
    return action('signal', { ...message, id, channel: 'room', sessionId: state.sessionId });
  };
  state.pc.onicecandidate = event => { if (event.candidate) state.signal({ type: 'candidate', candidate: event.candidate.toJSON() }).catch(error => notice(error.message)); };
  state.pc.ondatachannel = event => bindSecureChannel(state, event.channel);
  state.pc.onconnectionstatechange = () => {
    if (secureRoom !== state) return;
    if (state.pc.connectionState === 'connected' && state.channel?.readyState === 'open') markSecureReady(state).catch(error => notice(error.message));
    if (['disconnected', 'failed'].includes(state.pc.connectionState)) {
      secureReady = false;
      action('secure-ready', { sessionId: state.sessionId, ready: false }).catch(() => {});
      showSecureState('Reconectando o canal protegido…');
      if (hosting && !state.retryTimer) state.retryTimer = setTimeout(async () => {
        state.retryTimer = undefined;
        if (secureRoom !== state || state.pc.connectionState === 'connected') return;
        if (++state.retries > 2 || state.channel?.readyState === 'closed') return showSecureState('Canal protegido indisponível. Saia e peça para entrar novamente.');
        try { state.pc.restartIce(); await state.pc.setLocalDescription(await state.pc.createOffer({ iceRestart: true })); await state.signal({ type: 'offer', description: state.pc.localDescription.toJSON() }); }
        catch (error) { notice(error.message); }
      }, 3000);
    }
  };
  return state;
}
async function startSecureRoom(sessionId) {
  closeSecureRoom(); secureSession = sessionId;
  if (!peerFeatures.includes('secure-data')) return showSecureState('Atualize os dois computadores para conversa e arquivos protegidos.');
  showSecureState('Preparando conversa e arquivos protegidos…');
  if (!hosting) return;
  const state = createSecureRoom(crypto.randomUUID());
  bindSecureChannel(state, state.pc.createDataChannel('share-local-secure-v1', { ordered: true }));
  await state.pc.setLocalDescription(await state.pc.createOffer());
  await state.signal({ type: 'offer', description: state.pc.localDescription.toJSON() });
}
async function receiveSecureSignal(message) {
  if (!connected || !peerFeatures.includes('secure-data')) return;
  let state = secureRoom;
  if (message.type === 'offer') {
    if (hosting) return;
    if (!state || state.id !== message.id) {
      const waiting = secureCandidates.get(message.id);
      closeSecureRoom(); state = createSecureRoom(message.id);
      if (waiting) secureCandidates.set(message.id, waiting);
    }
    await state.pc.setRemoteDescription(message.description);
    for (const candidate of secureCandidates.get(state.id) || []) await state.pc.addIceCandidate(candidate);
    secureCandidates.delete(state.id);
    await state.pc.setLocalDescription(await state.pc.createAnswer());
    await state.signal({ type: 'answer', description: state.pc.localDescription.toJSON() });
  } else if (message.type === 'answer' && state?.id === message.id) {
    await state.pc.setRemoteDescription(message.description);
    for (const candidate of secureCandidates.get(state.id) || []) await state.pc.addIceCandidate(candidate);
    secureCandidates.delete(state.id);
  } else if (message.type === 'candidate') {
    if (state?.id === message.id && state.pc.remoteDescription) await state.pc.addIceCandidate(message.candidate);
    else {
      if (!secureCandidates.has(message.id) && secureCandidates.size < 4) secureCandidates.set(message.id, []);
      const list = secureCandidates.get(message.id);
      if (list?.length < 64) list.push(message.candidate);
    }
  }
}
async function sendSecurePacket(data) {
  const state = secureRoom;
  let failed = false;
  try {
    if (!secureReady || !state || state.sessionId !== data.sessionId || state.channel?.readyState !== 'open') throw new Error('Canal protegido indisponível.');
    if (state.channel.bufferedAmount > 256 * 1024) throw new Error('Aguarde o envio anterior.');
    if (typeof data.packet === 'string') state.channel.send(data.packet);
    else {
      const bytes = new Uint8Array(data.packet), sequence = ++state.sequence;
      if (sequence > 0xffffffff) throw new Error('Reconecte à sala para continuar.');
      const packet = new Uint8Array(bytes.length + 4); new DataView(packet.buffer).setUint32(0, sequence); packet.set(bytes, 4);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { state.pending.delete(sequence); reject(new Error('A gravação no outro computador não respondeu.')); }, 10000);
        state.pending.set(sequence, { resolve, reject, timer });
        try { state.channel.send(packet); } catch (error) { clearTimeout(timer); state.pending.delete(sequence); reject(error); }
      });
    }
  } catch { failed = true; }
  await action('secure-sent', { sessionId: data.sessionId, id: data.id, error: failed }).catch(() => {});
}
