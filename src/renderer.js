const $ = id => document.getElementById(id);
let connected = false, hosting = false, outgoing, incoming, noticeTimer, userMuted = false;
let signalQueue = Promise.resolve();
const earlyCandidates = new Map();
const discovered = new Map();
async function action(name, data) {
  const result = await window.canto.action(name, data);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 9000);
}
function bind(id, handler) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await handler(); } catch (error) { notice(error.message); }
    finally { if (id !== 'check-updates') $(id).disabled = id === 'share' ? !connected : false; }
  });
}
function showRoom(name) {
  $('lobby').hidden = true;
  $('room').hidden = false;
  $('room-title').textContent = name;
  $('invite').hidden = !hosting;
}
function updateConnection(value) {
  connected = value;
  $('share').disabled = !value;
  $('peer-state').textContent = value ? '● Vocês estão conectados' : '○ Esperando companhia';
  $('connection').textContent = value ? '● Juntos na sala' : '● Rede local';
  $('stage-title').textContent = value ? 'Humanos conectados. Gatos acomodados.' : 'O sofá já tem companhia.';
  $('stage-subtitle').textContent = value ? 'Qualquer um dos dois pode compartilhar a tela.' : 'Esperando sua pessoa entrar na sala…';
}
function stopIncoming() {
  if (incoming) { earlyCandidates.delete(incoming.id); incoming.pc.close(); incoming = undefined; }
  $('remote').srcObject = null;
  $('remote').hidden = true;
  $('stage-empty').hidden = false;
  $('mute').hidden = $('fullscreen').hidden = $('play').hidden = true;
}
function stopOutgoing(notify = true) {
  const previous = outgoing;
  outgoing = undefined;
  if (previous) {
    previous.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    previous.pc.close();
    earlyCandidates.delete(previous.id);
    if (notify && connected) action('signal', { type: 'stop', id: previous.id }).catch(error => notice(error.message));
  }
  $('preview').srcObject = null;
  $('preview-wrap').hidden = $('stop').hidden = true;
  $('share').hidden = false;
  updateRemoteAudio();
}
function updateRemoteAudio() {
  $('remote').muted = Boolean(outgoing) || userMuted;
  $('mute').disabled = Boolean(outgoing);
  $('mute').textContent = outgoing ? 'Áudio pausado durante envio' : userMuted ? 'Ativar áudio' : 'Silenciar';
}
function clearMedia() { stopOutgoing(false); stopIncoming(); earlyCandidates.clear(); }
function createPeer(id) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.onicecandidate = event => {
    if (event.candidate && connected) action('signal', { type: 'candidate', id, candidate: event.candidate.toJSON() }).catch(error => notice(error.message));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      notice('A transmissão não conectou. Confiram o firewall e se o Wi-Fi permite comunicação entre os computadores.');
      if (outgoing?.id === id) stopOutgoing();
      if (incoming?.id === id) stopIncoming();
    }
  };
  return pc;
}
async function flushCandidates(state) {
  const candidates = earlyCandidates.get(state.id) || [];
  earlyCandidates.delete(state.id);
  for (const candidate of candidates) await state.pc.addIceCandidate(candidate);
}
async function receive(msg) {
  if (!connected) return;
  if (msg.type === 'offer') {
    stopIncoming();
    const state = { id: msg.id, pc: createPeer(msg.id) };
    incoming = state;
    const stream = new MediaStream();
    state.pc.ontrack = event => {
      if (incoming !== state) return;
      stream.addTrack(event.track);
      $('remote').srcObject = stream;
      $('remote').hidden = false;
      $('stage-empty').hidden = true;
      $('mute').hidden = $('fullscreen').hidden = false;
      updateRemoteAudio();
      $('remote').play().catch(() => { $('play').hidden = false; });
    };
    await state.pc.setRemoteDescription(msg.description);
    await flushCandidates(state);
    await state.pc.setLocalDescription(await state.pc.createAnswer());
    await action('signal', { type: 'answer', id: state.id, description: state.pc.localDescription.toJSON() });
  } else if (msg.type === 'answer' && outgoing?.id === msg.id) {
    await outgoing.pc.setRemoteDescription(msg.description);
    await flushCandidates(outgoing);
  } else if (msg.type === 'candidate') {
    const state = outgoing?.id === msg.id ? outgoing : incoming?.id === msg.id ? incoming : null;
    if (state?.pc.remoteDescription) await state.pc.addIceCandidate(msg.candidate);
    else {
      if (!earlyCandidates.has(msg.id) && earlyCandidates.size < 8) earlyCandidates.set(msg.id, []);
      const list = earlyCandidates.get(msg.id);
      if (list && list.length < 64) list.push(msg.candidate);
    }
  } else if (msg.type === 'stop') {
    if (incoming?.id === msg.id) stopIncoming();
    earlyCandidates.delete(msg.id);
  }
}
bind('host', async () => {
  const room = await action('host', $('room-name').value);
  hosting = true;
  updateConnection(false);
  showRoom(room.name);
  $('invite-code').textContent = room.code;
  $('invite-ip').textContent = room.addresses.join(' · ') || 'Sem rede. Conecte ao Wi-Fi e abra a sala novamente.';
});
bind('join', async () => {
  const room = await action('join', { address: $('address').value.trim(), code: $('code').value.trim() });
  hosting = false;
  updateConnection(true);
  showRoom(room.name);
});
bind('leave', async () => {
  updateConnection(false);
  clearMedia();
  await action('leave');
  hosting = false;
  $('room').hidden = true;
  $('lobby').hidden = false;
});
bind('share', async () => {
  const sources = await action('sources');
  $('sources').replaceChildren();
  if (!sources.length) throw new Error('Nenhuma tela disponível para compartilhar.');
  for (const source of sources) {
    const button = document.createElement('button');
    const img = document.createElement('img');
    img.src = source.thumbnail;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = source.name;
    button.append(img, label);
    button.addEventListener('click', async () => {
      $('picker').close();
      if (!connected || outgoing) return;
      let stream;
      try {
        await action('select-source', source.id);
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true });
        if (!connected) { stream.getTracks().forEach(track => track.stop()); return; }
        const state = { id: crypto.randomUUID(), stream, pc: null };
        state.pc = createPeer(state.id);
        outgoing = state;
        updateRemoteAudio();
        stream.getTracks().forEach(track => state.pc.addTrack(track, stream));
        stream.getVideoTracks()[0].onended = () => { if (outgoing === state) stopOutgoing(); };
        $('preview').srcObject = stream;
        $('preview-wrap').hidden = $('stop').hidden = false;
        $('share').hidden = true;
        await state.pc.setLocalDescription(await state.pc.createOffer());
        await action('signal', { type: 'offer', id: state.id, description: state.pc.localDescription.toJSON() });
        if (!stream.getAudioTracks().length) notice('A tela está sendo compartilhada, mas o Windows não disponibilizou áudio nesta captura.');
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        stopOutgoing();
        notice(`Não foi possível compartilhar: ${error.message}`);
      }
    });
    $('sources').append(button);
  }
  $('picker').showModal();
});
bind('stop', () => stopOutgoing());
bind('cancel-picker', () => $('picker').close());
bind('mute', () => { userMuted = !userMuted; updateRemoteAudio(); });
bind('fullscreen', () => $('remote').requestFullscreen());
bind('play', async () => { await $('remote').play(); $('play').hidden = true; });
window.canto.onEvent(({ type, data }) => {
  if (type === 'update-state') renderUpdate(data);
  if (type === 'connected') updateConnection(true);
  if (type === 'signal') signalQueue = signalQueue.then(() => receive(data)).catch(error => notice(`Falha na transmissão: ${error.message}`));
  if (type === 'disconnected') {
    updateConnection(false);
    clearMedia();
    if ($('picker').open) $('picker').close();
    if (!data.hosting) { $('room').hidden = true; $('lobby').hidden = false; }
    notice(data.hosting ? 'A outra pessoa saiu. A sala continua aberta.' : 'A sala foi fechada. Você pode entrar novamente.');
  }
  if (type === 'discovery-warning' || type === 'network-error') notice(data);
  if (type === 'discovered') {
    discovered.set(data.address, { ...data, seen: Date.now() });
    renderDiscovered();
  }
});
function renderDiscovered() {
  $('discovered').replaceChildren();
  for (const [address, entry] of discovered) {
    if (Date.now() - entry.seen > 7000) { discovered.delete(address); continue; }
    const button = document.createElement('button');
    button.textContent = `● ${entry.name} · ${address}`;
    button.addEventListener('click', () => { $('address').value = address; $('code').focus(); });
    $('discovered').append(button);
  }
}
setInterval(renderDiscovered, 3000);
function renderUpdate(state) {
  $('app-version').textContent = `Share Local · v${state.version}`;
  const messages = {
    development: 'Modo de desenvolvimento', unconfigured: 'Publicação ainda não configurada',
    idle: 'Atualizações automáticas ativas', checking: 'Buscando nova versão…', current: 'Você está na versão mais recente',
    downloading: `Baixando atualização · ${state.percent || 0}%`,
    waiting: connected || hosting ? 'Atualização pronta. Instalaremos ao sair da sala.' : 'Atualização pronta. O app vai reiniciar em instantes.',
    installing: 'Instalando atualização…', error: 'Sem atualização agora. Tentaremos novamente.'
  };
  $('update-status').textContent = messages[state.status] || 'Atualizações indisponíveis';
  $('check-updates').hidden = ['development', 'unconfigured'].includes(state.status);
  $('check-updates').disabled = ['checking', 'downloading', 'waiting', 'installing'].includes(state.status);
}
bind('check-updates', async () => renderUpdate(await action('check-updates')));
action('update-state').then(renderUpdate).catch(error => notice(error.message));
