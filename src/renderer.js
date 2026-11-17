const $ = id => document.getElementById(id);
let connected = false, hosting = false, outgoing, incoming, noticeTimer, userMuted = false;
let lobbyBusy = false, capturePending = false, captureSources = [], sourceKind = 'screen';
let pendingRequest, joinCancelled = false;
let localProfile, otherProfile, lastJoinAddress;
let connectionGeneration = 0, joinCountdown, requestCountdown;
let captureIncludesAudio = false;
let peerFeatures = [];
let signalQueue = Promise.resolve();
const earlyCandidates = new Map();
const discovered = new Map();
async function action(name, data) {
  const result = await window.canto.action(name, data);
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code });
  return result.value;
}
function renderProfiles() {
  $('profile-display-name').textContent = localProfile?.name || 'Seu perfil';
  $('profile-avatar').src = `assets/${localProfile?.avatar || 'zahir'}.svg`;
  $('self-name').textContent = localProfile?.name || 'Você';
  $('self-avatar').src = $('profile-avatar').src;
  $('other-name').textContent = otherProfile?.name || 'Esperando companhia';
  $('other-avatar').hidden = !otherProfile;
  $('other-avatar').src = `assets/${otherProfile?.avatar || 'zahir'}.svg`;
  $('other-state').textContent = otherProfile ? 'CONECTADO' : '1 VAGA';
  $('remote-caption').textContent = `${otherProfile?.name || 'Outra pessoa'} está compartilhando`;
  $('remote').setAttribute('aria-label', `Tela compartilhada por ${otherProfile?.name || 'outra pessoa'}`);
}
function showProfile() {
  if ($('profile-dialog').open) return $('profile-name').focus();
  $('profile-name').value = localProfile?.name || '';
  document.querySelector(`input[name="avatar"][value="${localProfile?.avatar || 'zahir'}"]`).checked = true;
  $('cancel-profile').hidden = !localProfile;
  $('profile-error').hidden = true;
  $('profile-dialog').showModal();
  $('profile-name').focus();
}
function clearJoinProblem() {
  $('join-error').hidden = $('join-help').hidden = $('retry-join').hidden = true;
}
function showJoinProblem(error) {
  const hints = {
    NETWORK: 'Confiram se os dois computadores estão na mesma rede, se a sala está aberta e se o Firewall permite o Share Local em redes privadas.',
    UNAVAILABLE: 'Peça para a outra pessoa conferir se a sala continua aberta. Se necessário, copie um novo convite.',
    EXPIRED: 'Peça para quem abriu a sala ficar de olho no pedido e tente novamente.',
    DECLINED: 'Combine a entrada com quem abriu a sala antes de enviar outro pedido.',
    ROOM_FULL: 'A sala comporta duas pessoas. Aguarde a outra pessoa sair.',
    ROOM_BUSY: 'Já existe um pedido aguardando resposta. Tente de novo em instantes.',
    TOO_MANY_ATTEMPTS: 'Aguarde um minuto antes de enviar outro pedido.',
    INVALID_ADDRESS: 'Cole o link completo do convite ou use um IP como 192.168.1.10.'
  };
  $('join-error').textContent = error.message;
  $('join-error').hidden = false;
  $('join-help').textContent = typeof hints[error.code] === 'string' ? hints[error.code] : 'Confira o convite ou o IP com quem abriu a sala e tente novamente.';
  $('join-help').hidden = false;
  $('retry-join').hidden = error.code === 'INVALID_ADDRESS';
}
function applyInvitation(invitation) {
  if (hosting || connected || lobbyBusy) return notice('Saia da sala ou cancele o pedido antes de abrir outro convite.');
  $('address').value = invitation.address;
  $('invitation-title').textContent = `Você recebeu um convite para ${invitation.name}`;
  $('invitation-banner').hidden = false;
  clearJoinProblem();
  renderDiscovered();
  if (!$('profile-dialog').open) $('join').focus();
}
function notice(message) {
  $('notice-message').textContent = message;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 9000);
}
function startCountdown(id, expiresAt) {
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    $(id).textContent = seconds ? `Expira em ${seconds} s` : 'Encerrando pedido…';
  };
  tick();
  return setInterval(tick, 1000);
}
function renderInvite(addresses) {
  $('invite-address').replaceChildren();
  for (const address of addresses) {
    const option = document.createElement('option');
    option.value = option.textContent = address;
    $('invite-address').append(option);
  }
  $('invite-ip').textContent = addresses[0] || 'Sem rede. Conecte ao Wi-Fi e abra a sala novamente.';
  $('invite-ip').hidden = addresses.length > 1;
  $('invite-address').hidden = $('invite-address-hint').hidden = addresses.length < 2;
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
      if (id !== 'check-updates') $(id).disabled = ['share', 'change-source'].includes(id) ? !connected || capturePending : id === 'retry-join' ? lobbyBusy : false;
      if (['show-chat', 'show-files', 'send-file'].includes(id)) updateRoomTools();
    }
  });
}
function bindForm(id, pendingLabel, handler) {
  const form = $(`${id}-form`), button = $(id), label = button.querySelector('[data-label]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (lobbyBusy) return;
    if (!localProfile) return showProfile();
    lobbyBusy = true;
    $('host').disabled = $('join').disabled = true;
    $('edit-profile').disabled = $('retry-join').disabled = true;
    renderDiscovered();
    for (const input of document.querySelectorAll('.card input')) input.disabled = true;
    form.setAttribute('aria-busy', 'true');
    $(`${id}-error`).hidden = true;
    if (id === 'join') clearJoinProblem();
    const previous = label.textContent;
    label.textContent = pendingLabel;
    if (id === 'join') { joinCancelled = false; $('join-pending').hidden = false; $('join-progress').textContent = 'Localizando a sala…'; $('connection').textContent = '○ Localizando sala'; }
    try { await handler(); }
    catch (error) {
      if (id !== 'join' || !joinCancelled) {
        if (id === 'join') showJoinProblem(error);
        else { $(`${id}-error`).textContent = error.message; $(`${id}-error`).hidden = false; }
      }
    }
    finally {
      lobbyBusy = false;
      $('host').disabled = $('join').disabled = false;
      $('edit-profile').disabled = $('retry-join').disabled = false;
      renderDiscovered();
      for (const input of document.querySelectorAll('.card input')) input.disabled = false;
      if (id === 'join') { $('join-pending').hidden = true; clearInterval(joinCountdown); $('join-countdown').textContent = ''; }
      if (id === 'join' && !connected) $('connection').textContent = '● Rede local';
      form.removeAttribute('aria-busy');
      label.textContent = previous;
      if (!$('lobby').hidden) button.focus();
    }
  });
  form.addEventListener('input', () => { $(`${id}-error`).hidden = true; if (id === 'join') clearJoinProblem(); });
}
function showRoom(name) {
  clearTimeout(noticeTimer);
  $('notice').hidden = true;
  $('lobby').hidden = true;
  $('room').hidden = false;
  $('room-title').textContent = name;
  $('invite').hidden = !hosting;
  $('invitation-banner').hidden = true;
  renderProfiles();
  $('participant-count').textContent = connected ? '2/2' : '1/2';
  $('room-title').focus();
}
function showLobby() {
  clearTimeout(noticeTimer);
  $('notice').hidden = true;
  const wasHosting = hosting;
  hosting = false;
  otherProfile = undefined;
  renderProfiles();
  clearJoinProblem();
  $('room').hidden = true;
  $('lobby').hidden = false;
  $('participant-count').textContent = '0/2';
  if ($('join-request').open) $('join-request').close();
  pendingRequest = undefined;
  $(wasHosting ? 'host' : 'address').focus();
}
function updateConnection(value) {
  const changed = connected !== value;
  if (connected !== value) connectionGeneration++;
  connected = value;
  if (!value) peerFeatures = [];
  if (changed && !value) resetRoomTools();
  updateRoomTools();
  $('share').disabled = !value || capturePending;
  $('change-source').disabled = !value || capturePending;
  $('participant-count').textContent = value ? '2/2' : hosting ? '1/2' : '0/2';
  $('peer-state').textContent = value ? '● Vocês estão conectados' : '○ Esperando companhia';
  $('connection').textContent = value ? '● Juntos na sala' : '● Rede local';
  renderProfiles();
  renderStage();
}
function renderStage() {
  $('stage-title').textContent = outgoing ? 'Sua tela está sendo compartilhada.' : capturePending ? 'Preparando sua transmissão…' : connected ? `${otherProfile?.name || 'Sua companhia'} chegou. Pode dar o play.` : 'O sofá está reservado.';
  $('stage-subtitle').textContent = outgoing ? 'Sua prévia aparece abaixo. A tela da outra pessoa aparecerá aqui.' : connected ? 'Escolha uma tela ou janela no botão Compartilhar tela.' : 'Envie o convite para sua pessoa entrar na sala.';
}
function stopIncoming() {
  if (incoming) { earlyCandidates.delete(incoming.id); incoming.pc.close(); incoming = undefined; }
  $('remote').srcObject = null;
  $('remote').hidden = true;
  $('remote-caption').hidden = true;
  $('stage-empty').hidden = false;
  $('mute').hidden = $('fullscreen').hidden = $('floating').hidden = $('play').hidden = $('audio-controls').hidden = true;
  if (document.body.classList.contains('floating')) action('floating', false).then(renderFloating).catch(error => notice(error.message));
}
function stopTracks(stream) {
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
}
function stopOutgoing(notify = true) {
  const previous = outgoing;
  outgoing = undefined;
  if (previous) {
    stopTracks(previous.stream);
    previous.pc.close();
    earlyCandidates.delete(previous.id);
    if (notify && connected) action('signal', { type: 'stop', id: previous.id }).catch(error => notice(error.message));
  }
  $('preview').srcObject = null;
  $('preview-wrap').hidden = $('stop').hidden = $('change-source').hidden = true;
  $('floating-sharing').hidden = true;
  $('share').hidden = false;
  updateRemoteAudio();
  renderStage();
}
function updateRemoteAudio() {
  const sendingAudio = (capturePending && captureIncludesAudio) || Boolean(outgoing?.stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled));
  $('remote').volume = Number($('remote-volume').value) / 100;
  $('volume-value').textContent = `${$('remote-volume').value}%`;
  $('remote-volume').setAttribute('aria-valuetext', $('volume-value').textContent);
  $('remote').muted = sendingAudio || userMuted;
  $('mute').disabled = sendingAudio;
  $('mute').textContent = sendingAudio ? 'Áudio pausado durante envio' : userMuted ? 'Ativar áudio' : 'Silenciar';
  $('mute').setAttribute('aria-pressed', String($('remote').muted));
}
function playRemote() {
  const stream = $('remote').srcObject;
  return $('remote').play().then(() => { if ($('remote').srcObject === stream) $('play').hidden = true; }).catch(error => {
    if ($('remote').srcObject === stream) $('play').hidden = false;
    throw error;
  });
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
      $('remote-caption').hidden = false;
      $('stage-empty').hidden = true;
      $('mute').hidden = !stream.getAudioTracks().length;
      $('fullscreen').hidden = false;
      $('floating').hidden = false;
      $('audio-controls').hidden = !stream.getAudioTracks().length;
      updateRemoteAudio();
      playRemote().catch(() => {});
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
  otherProfile = undefined;
  updateConnection(false);
  showRoom(room.name);
  renderInvite(room.addresses);
});
bindForm('join', 'Enviando pedido…', async () => {
  lastJoinAddress = $('address').value.trim();
  const room = await action('join', { address: lastJoinAddress });
  lastJoinAddress = room.address;
  otherProfile = room.profile;
  peerFeatures = room.features || [];
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
  await action('copy-invite', $('invite-address').value || undefined);
  notice('Convite copiado. O link abre o Share Local de quem você convidar.');
});
bind('retry-join', () => { $('join-form').requestSubmit(); });
bind('edit-profile', showProfile);
bind('cancel-profile', () => $('profile-dialog').close());
$('profile-dialog').addEventListener('cancel', event => { if (!localProfile) event.preventDefault(); });
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('save-profile').disabled) return;
  $('save-profile').disabled = true;
  $('profile-error').hidden = true;
  try {
    localProfile = await action('save-profile', { name: $('profile-name').value.trim(), avatar: document.querySelector('input[name="avatar"]:checked').value });
    renderProfiles();
    $('host').disabled = $('join').disabled = false;
    $('profile-dialog').close();
    if (!$('invitation-banner').hidden) $('join').focus();
    notice('Seu perfil foi salvo neste computador.');
  } catch (error) { $('profile-error').textContent = error.message; $('profile-error').hidden = false; }
  finally { $('save-profile').disabled = false; }
});
bind('cancel-join', async () => { joinCancelled = true; await action('leave'); });
bind('approve-join', () => action('respond-join', { id: pendingRequest?.id, approve: true }));
bind('reject-join', () => action('respond-join', { id: pendingRequest?.id, approve: false }));
$('join-request').addEventListener('cancel', event => { event.preventDefault(); $('reject-join').click(); });
async function openSourcePicker() {
  captureSources = await action('sources');
  if (!connected) return;
  if (!captureSources.length) throw new Error('Nenhuma tela disponível para compartilhar.');
  sourceKind = outgoing?.source.id.startsWith('window:') ? 'window' : captureSources.some(source => source.id.startsWith('screen:')) ? 'screen' : 'window';
  $('picker-title').textContent = outgoing ? 'Trocar a tela compartilhada' : 'O que vamos assistir?';
  $('picker-description').textContent = outgoing ? 'A transmissão atual continua até a nova tela estar pronta. Clique na prévia para trocar.' : 'Clique em uma prévia para começar. Escolha abaixo se deseja incluir o áudio.';
  if (outgoing) $('share-audio').checked = outgoing.stream.getAudioTracks().length > 0;
  renderSources();
  $('picker').showModal();
}
bind('share', openSourcePicker);
bind('change-source', openSourcePicker);
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
  if (!connected || capturePending) return;
  const generation = connectionGeneration, previous = outgoing, includeAudio = $('share-audio').checked;
  capturePending = true;
  captureIncludesAudio = includeAudio;
  $('share').disabled = $('change-source').disabled = true;
  $('change-source').textContent = 'Trocando tela…';
  updateRemoteAudio();
  renderStage();
  let stream, state = previous, interrupted = false;
  try {
    await action('select-source', { id: source.id, audio: includeAudio });
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: includeAudio });
    if (generation !== connectionGeneration || !connected || outgoing !== previous) return;
    const video = stream.getVideoTracks()[0], audio = stream.getAudioTracks()[0] || null;
    if (!video || video.readyState !== 'live') throw new Error('A tela escolhida foi fechada. Escolha outra fonte.');
    if (previous) {
      const oldStream = previous.stream;
      try {
        await previous.videoSender.replaceTrack(video);
        await previous.audioSender.replaceTrack(audio);
        if (video.readyState !== 'live') throw new Error('A nova tela foi encerrada antes da troca.');
      } catch (error) {
        if (outgoing === previous) {
          try {
            await previous.videoSender.replaceTrack(oldStream.getVideoTracks()[0]);
            await previous.audioSender.replaceTrack(oldStream.getAudioTracks()[0] || null);
          } catch { interrupted = true; stopOutgoing(); }
        }
        throw error;
      }
      if (generation !== connectionGeneration || outgoing !== previous) return;
      previous.stream = stream;
      previous.source = source;
      stopTracks(oldStream);
    } else {
      state = { id: crypto.randomUUID(), stream, source, pc: null };
      state.pc = createPeer(state.id);
      state.videoSender = state.pc.addTrack(video, stream);
      state.audioSender = state.pc.addTransceiver('audio', { direction: 'sendonly', streams: [stream] }).sender;
      outgoing = state;
      await state.audioSender.replaceTrack(audio);
    }
    video.onended = () => { if (outgoing === state && state.stream === stream) stopOutgoing(); };
    if (generation !== connectionGeneration || outgoing !== state) return;
    $('preview').srcObject = stream;
    $('shared-source').textContent = source.name;
    $('capture-audio').textContent = audio ? 'Áudio do computador incluído. O som recebido fica pausado durante o envio para evitar retorno.' : 'Só imagem. Você pode continuar ouvindo a outra pessoa.';
    $('preview-wrap').hidden = $('stop').hidden = $('change-source').hidden = false;
    $('floating-sharing').hidden = false;
    $('share').hidden = true;
    updateRemoteAudio();
    renderStage();
    if (!previous) {
      await state.pc.setLocalDescription(await state.pc.createOffer());
      if (generation !== connectionGeneration || outgoing !== state) return;
      await action('signal', { type: 'offer', id: state.id, description: state.pc.localDescription.toJSON() });
    }
    if (includeAudio && !audio) notice('A tela está sendo compartilhada, mas o Windows não disponibilizou áudio nesta captura.');
  } catch (error) {
    if (generation !== connectionGeneration || (state && outgoing !== state && !interrupted)) return;
    if (!previous && outgoing === state) stopOutgoing();
    const message = ['AbortError', 'NotAllowedError'].includes(error.name) ? 'A captura foi cancelada.' : error.message;
    notice(previous && outgoing === previous ? `A tela anterior continua sendo compartilhada. ${message}` : `Não foi possível compartilhar: ${message}`);
  } finally {
    if (stream && outgoing?.stream !== stream) stopTracks(stream);
    capturePending = false;
    $('share').disabled = $('change-source').disabled = !connected;
    $('change-source').textContent = 'Trocar tela';
    updateRemoteAudio();
    renderStage();
  }
}
bind('filter-screens', () => { sourceKind = 'screen'; renderSources(); });
bind('filter-windows', () => { sourceKind = 'window'; renderSources(); });
bind('stop', () => stopOutgoing());
bind('cancel-picker', () => $('picker').close());
bind('mute', () => { userMuted = !userMuted; updateRemoteAudio(); });
$('remote-volume').addEventListener('input', updateRemoteAudio);
bind('fullscreen', () => $('remote').requestFullscreen());
bind('play', playRemote);
bind('dismiss-notice', () => { clearTimeout(noticeTimer); $('notice').hidden = true; });
$('address').addEventListener('input', () => { $('invitation-banner').hidden = true; renderDiscovered(); });
window.canto.onEvent(({ type, data }) => {
  if (type === 'update-state') renderUpdate(data);
  if (type === 'connected') { clearTimeout(noticeTimer); $('notice').hidden = true; otherProfile = data.profile; peerFeatures = data.features || []; updateConnection(true); }
  if (type === 'chat-message') appendChat(data);
  if (type === 'file-state') renderFileState(data);
  if (type === 'floating-state') renderFloating(data);
  if (type === 'peer-profile') { otherProfile = data; renderProfiles(); renderStage(); }
  if (type === 'invitation') applyInvitation(data);
  if (type === 'invitation-warning') notice(data);
  if (type === 'join-pending') {
    clearInterval(joinCountdown);
    joinCountdown = startCountdown('join-countdown', data.expiresAt);
    $('join-progress').textContent = 'Pedido enviado. Aguardando a outra pessoa autorizar…';
    $('connection').textContent = '○ Aguardando autorização';
    $('join').querySelector('[data-label]').textContent = 'Aguardando autorização…';
  }
  if (type === 'join-request') {
    pendingRequest = data;
    $('request-title').textContent = `${data.profile.name} quer entrar`;
    $('request-avatar').src = `assets/${data.profile.avatar}.svg`;
    $('request-address').textContent = data.address;
    clearInterval(requestCountdown);
    requestCountdown = startCountdown('request-countdown', data.expiresAt);
    $('join-request').showModal();
  }
  if (type === 'join-request-ended' && pendingRequest?.id === data.id) {
    pendingRequest = undefined;
    clearInterval(requestCountdown);
    $('join-request').close();
  }
  if (type === 'signal') signalQueue = signalQueue.then(() => receive(data)).catch(error => notice(`Falha na transmissão: ${error.message}`));
  if (type === 'disconnected') {
    const previousName = otherProfile?.name || 'A outra pessoa';
    otherProfile = undefined;
    updateConnection(false);
    clearMedia();
    if ($('picker').open) $('picker').close();
    if (!data.hosting) {
      const roomName = $('room-title').textContent;
      showLobby();
      if (lastJoinAddress) $('address').value = lastJoinAddress;
      showJoinProblem({ code: 'UNAVAILABLE', message: `A conexão com ${roomName} foi encerrada. Você pode pedir para entrar novamente.` });
    }
    notice(data.hosting ? `${previousName} saiu ou perdeu a conexão. A sala continua aberta.` : 'A conexão com a sala foi encerrada. Use Tentar novamente para enviar um novo pedido.');
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
      button.addEventListener('click', () => { $('address').value = address; $('invitation-banner').hidden = true; clearJoinProblem(); renderDiscovered(); $('join').focus(); });
      $('discovered').append(button);
    }
    button.textContent = `● ${entry.name} · ${address}`;
    button.setAttribute('aria-pressed', String($('address').value.trim() === address));
    button.disabled = lobbyBusy;
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
action('initial-state').then(state => {
  localProfile = state.profile;
  renderProfiles();
  $('host').disabled = $('join').disabled = !localProfile;
  if (state.invitation) applyInvitation(state.invitation);
  if (state.inviteError) notice(state.inviteError);
  if (!localProfile) showProfile();
}).catch(error => { notice(`Não foi possível carregar seu perfil: ${error.message}`); showProfile(); });
