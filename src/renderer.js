const $ = id => document.getElementById(id);
let connected = false, hosting = false, outgoing, incoming, noticeTimer, userMuted = false;
let lobbyBusy = false, capturePending = false, captureSources = [], sourceKind = 'screen';
let pendingRequest, joinCancelled = false;
let signalQueue = Promise.resolve();
const earlyCandidates = new Map();
const discovered = new Map();
async function action(name, data) {
  const result = await window.canto.action(name, data);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function notice(message) {
  $('notice-message').textContent = message;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 9000);
}
function bind(id, handler) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    $(id).setAttribute('aria-busy', 'true');
    const label = $(id).textContent;
    if ($(id).dataset.pending) $(id).textContent = $(id).dataset.pending;
    try { await handler(); } catch (error) { notice(error.message); }
    finally {
      if ($(id).dataset.pending) $(id).textContent = label;
      $(id).removeAttribute('aria-busy');
      if (id !== 'check-updates') $(id).disabled = id === 'share' ? !connected || capturePending : false;
    }
  });
}
function bindForm(id, pendingLabel, handler) {
  const form = $(`${id}-form`), button = $(id), label = button.querySelector('[data-label]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (lobbyBusy) return;
    lobbyBusy = true;
    $('host').disabled = $('join').disabled = true;
    for (const input of document.querySelectorAll('.card input')) input.disabled = true;
    form.setAttribute('aria-busy', 'true');
    $(`${id}-error`).hidden = true;
    const previous = label.textContent;
    label.textContent = pendingLabel;
    if (id === 'join') { joinCancelled = false; $('join-pending').hidden = false; $('join-progress').textContent = 'Localizando a sala…'; }
    try { await handler(); }
    catch (error) {
      if (id !== 'join' || !joinCancelled) {
        $(`${id}-error`).textContent = error.message;
        $(`${id}-error`).hidden = false;
      }
    }
    finally {
      lobbyBusy = false;
      $('host').disabled = $('join').disabled = false;
      for (const input of document.querySelectorAll('.card input')) input.disabled = false;
      if (id === 'join') $('join-pending').hidden = true;
      form.removeAttribute('aria-busy');
      label.textContent = previous;
      if (!$('lobby').hidden) button.focus();
    }
  });
  form.addEventListener('input', () => { $(`${id}-error`).hidden = true; });
}
function showRoom(name) {
  clearTimeout(noticeTimer);
  $('notice').hidden = true;
  $('lobby').hidden = true;
  $('room').hidden = false;
  $('room-title').textContent = name;
  $('invite').hidden = !hosting;
  $('participant-count').textContent = connected ? '2/2' : '1/2';
  $('room-title').focus();
}
function showLobby() {
  clearTimeout(noticeTimer);
  $('notice').hidden = true;
  const wasHosting = hosting;
  hosting = false;
  $('room').hidden = true;
  $('lobby').hidden = false;
  $('participant-count').textContent = '0/2';
  if ($('join-request').open) $('join-request').close();
  pendingRequest = undefined;
  $(wasHosting ? 'host' : 'address').focus();
}
function updateConnection(value) {
  connected = value;
  $('share').disabled = !value || capturePending;
  $('participant-count').textContent = value ? '2/2' : hosting ? '1/2' : '0/2';
  $('peer-state').textContent = value ? '● Vocês estão conectados' : '○ Esperando companhia';
  $('connection').textContent = value ? '● Juntos na sala' : '● Rede local';
  renderStage();
}
function renderStage() {
  $('stage-title').textContent = outgoing ? 'Sua tela está sendo compartilhada.' : connected ? 'Humanos conectados. Gatos acomodados.' : 'O sofá está reservado.';
  $('stage-subtitle').textContent = outgoing ? 'Sua prévia aparece abaixo. A tela da outra pessoa aparecerá aqui.' : connected ? 'Escolha uma tela ou janela no botão Compartilhar tela.' : 'Envie o convite para sua pessoa entrar na sala.';
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
  renderStage();
}
function updateRemoteAudio() {
  $('remote').muted = Boolean(outgoing) || userMuted;
  $('mute').disabled = Boolean(outgoing);
  $('mute').textContent = outgoing ? 'Áudio pausado durante envio' : userMuted ? 'Ativar áudio' : 'Silenciar';
  $('mute').setAttribute('aria-pressed', String($('remote').muted));
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
bindForm('host', 'Abrindo sala…', async () => {
  const room = await action('host', $('room-name').value);
  hosting = true;
  updateConnection(false);
  showRoom(room.name);
  $('invite-ip').textContent = room.addresses.join(' · ') || 'Sem rede. Conecte ao Wi-Fi e abra a sala novamente.';
});
bindForm('join', 'Enviando pedido…', async () => {
  const room = await action('join', { address: $('address').value.trim() });
  hosting = false;
  updateConnection(true);
  showRoom(room.name);
});
bind('leave', async () => {
  updateConnection(false);
  clearMedia();
  await action('leave');
  showLobby();
});
bind('copy-invite', async () => {
  await action('copy-invite');
  notice('Convite copiado. Envie para quem você quer na sala.');
});
bind('cancel-join', async () => { joinCancelled = true; await action('leave'); });
bind('approve-join', () => action('respond-join', { id: pendingRequest?.id, approve: true }));
bind('reject-join', () => action('respond-join', { id: pendingRequest?.id, approve: false }));
$('join-request').addEventListener('cancel', event => { event.preventDefault(); $('reject-join').click(); });
bind('share', async () => {
  captureSources = await action('sources');
  if (!connected) return;
  if (!captureSources.length) throw new Error('Nenhuma tela disponível para compartilhar.');
  sourceKind = captureSources.some(source => source.id.startsWith('screen:')) ? 'screen' : 'window';
  renderSources();
  $('picker').showModal();
});
function renderSources() {
  $('sources').replaceChildren();
  for (const [kind, id, label] of [['screen', 'filter-screens', 'Telas'], ['window', 'filter-windows', 'Janelas']]) {
    $(id).textContent = `${label} (${captureSources.filter(source => source.id.startsWith(`${kind}:`)).length})`;
    $(id).setAttribute('aria-pressed', String(sourceKind === kind));
  }
  const sources = captureSources.filter(source => source.id.startsWith(`${sourceKind}:`));
  $('sources-empty').textContent = sourceKind === 'screen' ? 'Nenhuma tela disponível. Verifique as janelas abertas.' : 'Nenhuma janela disponível. Escolha uma tela ou abra a janela e tente novamente.';
  $('sources-empty').hidden = sources.length > 0;
  for (const source of sources) {
    const button = document.createElement('button');
    const img = document.createElement('img');
    img.src = source.thumbnail;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = source.name;
    button.title = source.name;
    button.append(img, label);
    button.addEventListener('click', () => startSharing(source));
    $('sources').append(button);
  }
}
async function startSharing(source) {
  $('picker').close();
  if (!connected || outgoing || capturePending) return;
  capturePending = true;
  $('share').disabled = true;
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
    $('shared-source').textContent = source.name;
    $('capture-audio').textContent = stream.getAudioTracks().length ? 'Áudio do computador incluído. O som recebido fica pausado durante o envio para evitar retorno.' : 'Sem áudio nesta captura.';
    $('preview-wrap').hidden = $('stop').hidden = false;
    $('share').hidden = true;
    renderStage();
    await state.pc.setLocalDescription(await state.pc.createOffer());
    await action('signal', { type: 'offer', id: state.id, description: state.pc.localDescription.toJSON() });
    if (!stream.getAudioTracks().length) notice('A tela está sendo compartilhada, mas o Windows não disponibilizou áudio nesta captura.');
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    stopOutgoing();
    notice(`Não foi possível compartilhar: ${error.message}`);
  } finally {
    capturePending = false;
    $('share').disabled = !connected;
  }
}
bind('filter-screens', () => { sourceKind = 'screen'; renderSources(); });
bind('filter-windows', () => { sourceKind = 'window'; renderSources(); });
bind('stop', () => stopOutgoing());
bind('cancel-picker', () => $('picker').close());
bind('mute', () => { userMuted = !userMuted; updateRemoteAudio(); });
bind('fullscreen', () => $('remote').requestFullscreen());
bind('play', async () => { await $('remote').play(); $('play').hidden = true; });
bind('dismiss-notice', () => { clearTimeout(noticeTimer); $('notice').hidden = true; });
$('address').addEventListener('input', renderDiscovered);
window.canto.onEvent(({ type, data }) => {
  if (type === 'update-state') renderUpdate(data);
  if (type === 'connected') updateConnection(true);
  if (type === 'join-pending') {
    $('join-progress').textContent = 'Pedido enviado. Aguardando a outra pessoa autorizar…';
    $('join').querySelector('[data-label]').textContent = 'Aguardando autorização…';
  }
  if (type === 'join-request') {
    pendingRequest = data;
    $('request-address').textContent = data.address;
    $('join-request').showModal();
  }
  if (type === 'join-request-ended' && pendingRequest?.id === data.id) {
    pendingRequest = undefined;
    $('join-request').close();
  }
  if (type === 'signal') signalQueue = signalQueue.then(() => receive(data)).catch(error => notice(`Falha na transmissão: ${error.message}`));
  if (type === 'disconnected') {
    updateConnection(false);
    clearMedia();
    if ($('picker').open) $('picker').close();
    if (!data.hosting) showLobby();
    notice(data.hosting ? 'A outra pessoa saiu. A sala continua aberta.' : 'A sala foi fechada. Você pode entrar novamente.');
  }
  if (type === 'discovery-warning' || type === 'network-error') notice(data);
  if (type === 'discovered') {
    discovered.set(data.address, { ...data, seen: Date.now() });
    renderDiscovered();
  }
});
function renderDiscovered() {
  const buttons = new Map(Array.from($('discovered').children, button => [button.dataset.address, button]));
  for (const [address, entry] of discovered) {
    if (Date.now() - entry.seen > 7000) { discovered.delete(address); continue; }
    let button = buttons.get(address);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.address = address;
      button.addEventListener('click', () => { $('address').value = address; $('join-error').hidden = true; renderDiscovered(); $('join').focus(); });
      $('discovered').append(button);
    }
    button.textContent = `● ${entry.name} · ${address}`;
    button.setAttribute('aria-pressed', String($('address').value.trim() === address));
    buttons.delete(address);
  }
  for (const button of buttons.values()) button.remove();
  $('discovery-status').textContent = discovered.size ? `${discovered.size} ${discovered.size === 1 ? 'sala encontrada. Selecione para preencher o IP.' : 'salas encontradas. Selecione para preencher o IP.'}` : 'Nenhuma sala encontrada ainda. Você também pode entrar pelo IP.';
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
