const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WebSocket, WebSocketServer } = require('ws');
const { localAddresses, validAddress } = require('../src/protocol.cjs');
const { makeInvitation, parseInvitation } = require('../src/invitations.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 19337;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.CANTO_TEST_EXECUTABLE;
const executable = packaged || require('electron');
const userData = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'share-local-smoke-'));
const launchArgs = ['.', '--smoke-test', `--smoke-user-data=${userData}`];
const child = spawn(executable, [...launchArgs, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--', makeInvitation('192.168.1.42', 'Convite inicial')], {
  cwd: path.join(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
});
const childClosed = once(child, 'exit');
let debug, guest, externalServer, stderr = '';
child.stderr.on('data', data => { stderr += data; });
const pending = new Map();
let nextId = 0;
async function command(method, params = {}) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
  });
  debug.send(JSON.stringify({ id, method, params }));
  return result;
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`A interface não chegou ao estado esperado: ${expression}`);
}
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { captureBeyondViewport: name !== 'preview-floating.png' });
  await fs.writeFile(path.join(__dirname, '..', 'release', name), Buffer.from(result.data, 'base64'));
}
async function launchInvitation(link) {
  const second = spawn(executable, [...launchArgs, '--', link], { cwd: path.join(__dirname, '..'), env, windowsHide: true, stdio: 'ignore' });
  await once(second, 'exit', { signal: AbortSignal.timeout(10000) });
}
async function reloadPage() {
  const loaded = new Promise(resolve => {
    const listener = bytes => { if (JSON.parse(bytes).method === 'Page.loadEventFired') { debug.off('message', listener); resolve(); } };
    debug.on('message', listener);
  });
  await command('Page.reload');
  await loaded;
  await waitFor('Boolean(localProfile) && !$("profile-dialog").open');
}
async function connectGuest(message = { type: 'join-request' }) {
  const socket = new WebSocket('ws://127.0.0.1:45878');
  socket.on('error', () => {});
  const reply = once(socket, 'message');
  await once(socket, 'open');
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  return { socket, reply: JSON.parse((await reply)[0]) };
}
(async () => {
  let pages;
  for (let i = 0; i < 100; i++) {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (pages.some(p => p.url.endsWith('index.html'))) break; } catch {}
    await delay(200);
  }
  const page = pages?.find(p => p.url.endsWith('index.html'));
  assert.ok(page, `Aplicativo não abriu. ${stderr}`);
  debug = new WebSocket(page.webSocketDebuggerUrl);
  await once(debug, 'open');
  debug.on('message', bytes => {
    const msg = JSON.parse(bytes);
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    clearTimeout(item.timeout);
    if (msg.error) item.reject(new Error(msg.error.message)); else item.resolve(msg.result);
  });
  const errors = [];
  await command('Runtime.enable');
  debug.on('message', bytes => { const msg = JSON.parse(bytes); if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params); });
  await waitFor('document.readyState === "complete" && typeof action === "function"');
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await fs.mkdir(path.join(__dirname, '..', 'release'), { recursive: true });
  await waitFor('$("profile-dialog").open');
  assert.equal(await evaluate('$("address").value'), '192.168.1.42');
  assert.equal(await evaluate('!lobbyBusy && !connected && !$("invitation-banner").hidden'), true);
  await screenshot('preview-profile.png');
  await evaluate(`$('profile-name').value = 'Ygor de teste'; document.querySelector('input[name="avatar"][value="priya"]').checked = true; $('profile-form').requestSubmit()`);
  await waitFor('!$("profile-dialog").open && !$("host").disabled');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(userData, 'profile.json'), 'utf8')), { name: 'Ygor de teste', avatar: 'priya' });
  await command('Page.enable');
  await reloadPage();
  assert.equal(await evaluate('localProfile.name'), 'Ygor de teste');
  assert.equal(await evaluate('localProfile.avatar'), 'priya');
  await launchInvitation(makeInvitation('192.168.1.43', 'Convite por link'));
  await waitFor('$("address").value === "192.168.1.43" && !$("invitation-banner").hidden');
  assert.equal(await evaluate('lobbyBusy || connected'), false, 'Convite não deve enviar um pedido automaticamente.');
  await launchInvitation('share-local://join?address=8.8.8.8');
  await waitFor('$("notice-message").textContent.includes("convite não é válido")');
  assert.equal(await evaluate('$("address").value'), '192.168.1.43');
  await evaluate('$("dismiss-notice").click(); $("invitation-banner").hidden = true');
  assert.equal(await evaluate('Boolean(window.canto) && typeof require === "undefined"'), true);
  assert.equal(await evaluate('document.title'), 'Share Local');
  assert.equal(await evaluate('document.querySelectorAll(".hero-cats img").length'), 3);
  assert.equal(await evaluate('document.querySelector(".hero-cats img[src*=emma]").alt.includes("sem rabinho")'), true);
  const updateStatus = await evaluate('(async () => (await action("update-state")).status)()');
  if (packaged) assert.ok(['idle', 'checking', 'current', 'error'].includes(updateStatus), `Atualizador empacotado indisponível: ${updateStatus}`);
  else assert.equal(updateStatus, 'development');
  await fs.mkdir(path.join(__dirname, '..', 'release'), { recursive: true });
  await screenshot('preview.png');
  for (const width of [900, 760]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 650, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Layout transborda em ${width}px`);
  }
  await screenshot('preview-compact.png');
  await command('Emulation.clearDeviceMetricsOverride');
  assert.equal(await evaluate(`(() => {
    discovered.set('192.168.1.42', { name: 'Sala vizinha', seen: Date.now() });
    renderDiscovered();
    const button = $('discovered').firstElementChild;
    button.focus(); renderDiscovered();
    const stable = document.activeElement === button;
    button.click();
    const selected = $('address').value === '192.168.1.42' && document.activeElement === $('join');
    discovered.clear(); renderDiscovered();
    return stable && selected;
  })()`), true);
  await evaluate(`$('room-name').value = 'Sala de teste'; $('room-name').focus()`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor('!$("room").hidden && !lobbyBusy');
  assert.equal(await evaluate('$("participant-count").textContent'), '1/2');
  assert.equal(await evaluate('document.activeElement.id'), 'room-title');
  assert.equal(await evaluate('$("share").getBoundingClientRect().bottom <= innerHeight'), true, 'O botão de compartilhar precisa aparecer sem rolar a sala.');
  await launchInvitation(makeInvitation('192.168.1.44', 'Outra sala'));
  await waitFor('$("notice-message").textContent.includes("já está em uma sala")');
  assert.equal(await evaluate('$("room-title").textContent'), 'Sala de teste');
  assert.equal(await evaluate(`(() => {
    const actual = Array.from($('invite-address').options, option => option.value);
    renderInvite(['192.168.1.10', '10.0.0.4']);
    $('invite-address').value = '10.0.0.4';
    const selectable = !$('invite-address').hidden && $('invite-address').value === '10.0.0.4' && $('invite-ip').hidden;
    renderInvite(actual);
    return selectable;
  })()`), true);
  assert.equal(await evaluate('(async () => (await window.canto.action("copy-invite", "8.8.8.8")).ok)()'), false);
  await evaluate('$("copy-invite").click()');
  await waitFor('!$("copy-invite").disabled');
  assert.match(await evaluate('$("notice-message").textContent'), /Convite copiado/);
  const copiedInvite = await evaluate('action("copy-invite", $("invite-address").value || undefined)');
  assert.equal(parseInvitation(copiedInvite).address, await evaluate('$("invite-address").value'));
  await evaluate('$("dismiss-notice").click()');
  assert.equal(await evaluate('$("notice").hidden'), true);
  await screenshot('preview-room.png');

  const legacy = await connectGuest({ type: 'join', code: '123456' });
  assert.equal(legacy.reply.type, 'rejected');
  assert.match(legacy.reply.message, /Atualize/);
  legacy.socket.terminate();
  const invalidProfile = await connectGuest({ type: 'join-request', profile: { name: 'Visitante', avatar: '../../arquivo' } });
  assert.equal(invalidProfile.reply.type, 'rejected');
  invalidProfile.socket.terminate();
  const denied = await connectGuest();
  assert.equal(denied.reply.type, 'pending');
  await waitFor('$("join-request").open');
  assert.equal(await evaluate('$("request-title").textContent'), 'Outra pessoa quer entrar');
  assert.match(await evaluate('$("request-countdown").textContent'), /Expira em \d+ s/);
  assert.equal(await evaluate('!connected && $("share").disabled'), true);
  const rejected = once(denied.socket, 'message');
  const deniedClosed = once(denied.socket, 'close');
  await evaluate('$("reject-join").click()');
  assert.match(JSON.parse((await rejected)[0]).message, /recusado/);
  await deniedClosed;
  await waitFor('!$("join-request").open');

  const cancelled = await connectGuest();
  assert.equal(cancelled.reply.type, 'pending');
  await waitFor('$("join-request").open');
  const staleId = await evaluate('pendingRequest.id');
  cancelled.socket.terminate();
  await waitFor('!$("join-request").open');
  assert.equal(await evaluate(`(async () => (await window.canto.action('respond-join', { id: ${JSON.stringify(staleId)}, approve: true })).ok)()`), false);

  const expired = await connectGuest();
  assert.equal(expired.reply.type, 'pending');
  await waitFor('$("join-request").open');
  const expiredId = await evaluate('pendingRequest.id');
  const expiredReply = once(expired.socket, 'message', { signal: AbortSignal.timeout(65000) });
  const expiredClosed = once(expired.socket, 'close');
  console.log('Aguardando a expiração real do pedido de entrada (1 minuto)…');
  assert.match(JSON.parse((await expiredReply)[0]).message, /expirou/);
  await expiredClosed;
  await waitFor('!$("join-request").open');
  assert.equal(await evaluate('connected'), false);
  assert.equal(await evaluate(`(async () => (await window.canto.action('respond-join', { id: ${JSON.stringify(expiredId)}, approve: true })).ok)()`), false);

  const unauthorized = await connectGuest();
  assert.equal(unauthorized.reply.type, 'pending');
  const blocked = once(unauthorized.socket, 'message');
  const unauthorizedClosed = once(unauthorized.socket, 'close');
  unauthorized.socket.send(JSON.stringify({ type: 'stop', id: '12345678-1234-1234-1234-123456789abc' }));
  assert.equal(JSON.parse((await blocked)[0]).type, 'rejected');
  await unauthorizedClosed;
  await waitFor('!$("join-request").open');
  assert.equal(await evaluate('connected'), false);

  const accepted = await connectGuest({ type: 'join-request', profile: { name: 'Marina', avatar: 'emma' }, features: ['chat', 'files'] });
  guest = accepted.socket;
  assert.equal(accepted.reply.type, 'pending');
  await waitFor('$("join-request").open');
  assert.equal(await evaluate('$("request-title").textContent'), 'Marina quer entrar');
  assert.equal(await evaluate('$("request-avatar").getAttribute("src")'), 'assets/emma.svg');
  assert.equal(await evaluate(`(async () => (await window.canto.action('respond-join', { id: ${JSON.stringify(staleId)}, approve: true })).ok)()`), false);
  assert.equal(await evaluate('connected'), false);
  await screenshot('preview-request.png');
  const pendingThird = await connectGuest();
  assert.equal(pendingThird.reply.type, 'rejected');
  pendingThird.socket.terminate();
  const approved = once(guest, 'message');
  await evaluate('$("approve-join").click()');
  const approval = JSON.parse((await approved)[0]);
  assert.equal(approval.type, 'joined');
  assert.deepEqual(approval.profile, { name: 'Ygor de teste', avatar: 'priya' });
  await waitFor('connected && !$("join-request").open');
  assert.equal(await evaluate('connected'), true);
  assert.equal(await evaluate('$("participant-count").textContent'), '2/2');
  assert.equal(await evaluate('$("other-name").textContent'), 'Marina');
  guest.send(JSON.stringify({ type: 'profile', profile: { name: 'Marina <3', avatar: 'zahir' } }));
  await waitFor('$("other-name").textContent === "Marina <3"');
  guest.send(JSON.stringify({ type: 'profile', profile: { name: 'Inválido', avatar: 'https://evil.test/avatar' } }));
  await evaluate('$("edit-profile").click()');
  const changedProfile = once(guest, 'message');
  await evaluate(`$('profile-name').value = 'Ygor'; document.querySelector('input[name="avatar"][value="emma"]').checked = true; $('profile-form').requestSubmit()`);
  assert.deepEqual(JSON.parse((await changedProfile)[0]), { type: 'profile', profile: { name: 'Ygor', avatar: 'emma' } });
  await waitFor('!$("profile-dialog").open');
  assert.equal(await evaluate('$("other-name").textContent'), 'Marina <3');
  assert.equal(await evaluate('$("show-chat").disabled || $("show-files").disabled'), false);
  const chatId = '11111111-1234-1234-1234-123456789abc';
  guest.send(JSON.stringify({ type: 'chat', id: chatId, text: 'Olá <img src=x>! Veja https://example.com/video' }));
  await waitFor('$("chat-messages").children.length === 1');
  assert.equal(await evaluate('$("chat-messages").querySelectorAll("img,script").length'), 0);
  assert.equal(await evaluate('$("chat-messages").querySelector("a").href'), 'https://example.com/video');
  assert.equal(await evaluate('$("chat-badge").hidden'), false);
  await evaluate('$("show-chat").click()');
  await waitFor('!$("room-tools").hidden && !$("chat-panel").hidden');
  assert.equal(await evaluate('$("chat-badge").hidden'), true);
  const chatReply = once(guest, 'message');
  await evaluate('$("chat-input").value = "Vamos assistir 🐈"; $("chat-form").requestSubmit()');
  assert.equal(JSON.parse((await chatReply)[0]).text, 'Vamos assistir 🐈');
  await waitFor('$("chat-messages").children.length === 2');
  await screenshot('preview-chat.png');
  assert.equal(await evaluate('(async () => (await window.canto.action("open-link", "file:///C:/Windows")).ok)()'), false);
  const fileId = '22222222-1234-1234-1234-123456789abc';
  guest.send(JSON.stringify({ type: 'file-offer', id: fileId, name: 'foto de férias.png', size: 4096 }));
  await waitFor('!$("files-badge").hidden');
  await evaluate('$("show-files").click()');
  await waitFor('!$("files-panel").hidden');
  assert.equal(await evaluate('$("file-list").querySelector(".transfer-name").textContent'), 'foto de férias.png');
  await screenshot('preview-files.png');
  const refusedFile = once(guest, 'message');
  await evaluate('Array.from($("file-list").querySelectorAll("button")).find(button => button.textContent === "Recusar").click()');
  assert.equal(JSON.parse((await refusedFile)[0]).type, 'file-reject');
  await waitFor('$("file-list").textContent.includes("Arquivo recusado")');
  await evaluate('$("close-tools").click()');
  const third = new WebSocket('ws://127.0.0.1:45878');
  third.on('error', () => {});
  const [closeCode] = await once(third, 'close');
  assert.equal(closeCode, 1008);
  const received = once(guest, 'message');
  await evaluate('action("signal", { type: "stop", id: "12345678-1234-1234-1234-123456789abc" })');
  assert.equal(JSON.parse((await received)[0]).type, 'stop');
  await evaluate('$("share").click()');
  await waitFor('$("picker").open');
  assert.equal(await evaluate('$("sources").children.length === captureSources.filter(source => source.id.startsWith(`${sourceKind}:`)).length'), true);
  await screenshot('preview-picker.png');
  await evaluate('$("filter-windows").click()');
  assert.equal(await evaluate('$("filter-windows").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('$("sources").children.length === captureSources.filter(source => source.id.startsWith("window:")).length'), true);
  await evaluate('$("filter-screens").click(); $("share-audio").checked = false; $("sources").firstElementChild.click()');
  await waitFor('Boolean(outgoing?.pc.localDescription) && !capturePending');
  const capture = await evaluate('({ video: outgoing.stream.getVideoTracks().length, audio: outgoing.stream.getAudioTracks().length })');
  assert.equal(capture.video, 1);
  assert.equal(capture.audio, 0, 'Captura sem som não pode conter faixa de áudio.');
  await waitFor('outgoing.pc.iceGatheringState === "complete"');
  await evaluate(`(async () => {
    window.outgoingSink = new MediaStream();
    window.outgoingReceiver = new RTCPeerConnection({ iceServers: [] });
    outgoingReceiver.ontrack = event => outgoingSink.addTrack(event.track);
    await outgoingReceiver.setRemoteDescription(outgoing.pc.localDescription);
    await outgoingReceiver.setLocalDescription(await outgoingReceiver.createAnswer());
  })()`);
  await waitFor('outgoingReceiver.iceGatheringState === "complete"');
  const response = await evaluate('({ id: outgoing.id, description: outgoingReceiver.localDescription.toJSON() })');
  guest.send(JSON.stringify({ type: 'answer', ...response }));
  await waitFor('outgoing.pc.connectionState === "connected" && outgoingReceiver.connectionState === "connected"');
  await evaluate('window.originalShare = outgoing; window.originalTracks = outgoing.stream.getTracks(); $("change-source").click()');
  await waitFor('$("picker").open');
  await evaluate('$("share-audio").checked = true; ($( "sources").children[1] || $("sources").firstElementChild).click()');
  await waitFor('!capturePending && outgoing.stream.getAudioTracks().length > 0');
  assert.equal(await evaluate('outgoing === originalShare && outgoing.pc.connectionState === "connected" && originalTracks.every(track => track.readyState === "ended")'), true);
  assert.equal(await evaluate('$("remote").muted && $("mute").disabled'), true);
  await waitFor('(async () => Array.from((await outgoingReceiver.getStats()).values()).some(stat => stat.type === "inbound-rtp" && stat.kind === "audio" && stat.bytesReceived > 0))()');
  await evaluate('window.withAudioTracks = outgoing.stream.getTracks(); $("change-source").click()');
  await waitFor('$("picker").open');
  await evaluate('$("share-audio").checked = false; $("sources").firstElementChild.click()');
  await waitFor('!capturePending && outgoing.stream.getAudioTracks().length === 0');
  assert.equal(await evaluate('outgoing === originalShare && outgoing.audioSender.track === null && withAudioTracks.every(track => track.readyState === "ended") && !$("remote").muted'), true);
  await evaluate('window.beforeFailedSwitch = outgoing.stream; startSharing({ id: "window:gone", name: "Janela encerrada" })');
  assert.equal(await evaluate('outgoing.stream === beforeFailedSwitch && beforeFailedSwitch.getTracks().every(track => track.readyState === "live")'), true);
  assert.match(await evaluate('$("notice-message").textContent'), /tela anterior continua/);
  assert.equal(await evaluate(`(async () => {
    const actualCapture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    const actualReplace = outgoing.audioSender.replaceTrack.bind(outgoing.audioSender);
    const active = outgoing;
    const oldStream = active.stream;
    let calls = 0, rejectedStream;
    navigator.mediaDevices.getDisplayMedia = async options => { rejectedStream = await actualCapture(options); return rejectedStream; };
    active.audioSender.replaceTrack = track => ++calls === 1 ? Promise.reject(new Error('Falha simulada de troca')) : actualReplace(track);
    try {
      await startSharing(active.source);
      return outgoing === active && active.stream === oldStream && active.videoSender.track === oldStream.getVideoTracks()[0] &&
        oldStream.getTracks().every(track => track.readyState === 'live') && rejectedStream.getTracks().every(track => track.readyState === 'ended');
    } finally {
      navigator.mediaDevices.getDisplayMedia = actualCapture;
      active.audioSender.replaceTrack = actualReplace;
    }
  })()`), true);
  await evaluate('$("dismiss-notice").click()');
  await screenshot('preview-sharing.png');
  assert.equal(await evaluate('!$("preview-wrap").hidden && $("share").hidden && !$("stop").hidden'), true);
  await evaluate('window.capturedTracks = outgoing.stream.getTracks(); $("stop").click()');
  await waitFor('!outgoing');
  assert.equal(await evaluate('capturedTracks.every(track => track.readyState === "ended") && $("preview-wrap").hidden && !$("share").hidden'), true);
  await evaluate('outgoingReceiver.close(); outgoingSink.getTracks().forEach(track => track.stop())');
  await evaluate(`(() => {
    window.actualCapture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async options => {
      const stream = await actualCapture(options);
      window.heldCaptureStream = stream;
      await new Promise(resolve => { window.releaseHeldCapture = resolve; });
      return stream;
    };
    window.heldCapture = startSharing(captureSources.find(source => source.id.startsWith('screen:')));
    return true;
  })()`);
  await waitFor('Boolean(window.heldCaptureStream) && capturePending');
  guest.terminate();
  await waitFor('!connected');
  const reconnected = await connectGuest({ type: 'join-request', profile: { name: 'Marina <3', avatar: 'zahir' }, features: ['chat', 'files'] });
  guest = reconnected.socket;
  await waitFor('$("join-request").open');
  const reapproved = once(guest, 'message');
  await evaluate('$("approve-join").click()');
  assert.equal(JSON.parse((await reapproved)[0]).type, 'joined');
  await waitFor('connected');
  assert.equal(await evaluate('$("notice").hidden'), true);
  const unexpectedOffers = [];
  const recordOffer = bytes => { if (JSON.parse(bytes).type === 'offer') unexpectedOffers.push(JSON.parse(bytes)); };
  guest.on('message', recordOffer);
  assert.equal(await evaluate(`(async () => {
    try {
      releaseHeldCapture();
      await heldCapture;
      return !outgoing && heldCaptureStream.getTracks().every(track => track.readyState === 'ended');
    } finally { navigator.mediaDevices.getDisplayMedia = actualCapture; }
  })()`), true, 'Uma captura da conexão anterior não pode iniciar na conexão nova.');
  guest.off('message', recordOffer);
  assert.deepEqual(unexpectedOffers, []);
  console.log('Captura local:', capture);
  // Simulate a second WebRTC endpoint through the actual room signaling.
  const rtcId = 'abcdef12-1234-1234-1234-123456789abc';
  let rtcQueue = Promise.resolve();
  guest.on('message', bytes => {
    const msg = JSON.parse(bytes);
    if (msg.id !== rtcId) return;
    rtcQueue = rtcQueue.then(async () => {
      if (msg.type === 'answer') await evaluate(`window.testPeer.setRemoteDescription(${JSON.stringify(msg.description)})`);
      if (msg.type === 'candidate') await evaluate(`window.testPeer.addIceCandidate(${JSON.stringify(msg.candidate)})`);
    });
  });
  const offer = await evaluate(`(async () => {
    window.testCandidates = [];
    window.testPeer = new RTCPeerConnection({ iceServers: [] });
    testPeer.onicecandidate = event => { if (event.candidate) testCandidates.push(event.candidate.toJSON()); };
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#bca5fa'; ctx.fillRect(0, 0, 320, 180);
    let frame = 0;
    window.testFrameTimer = setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#bca5fa' : '#cdb6ff'; ctx.fillRect(0, 0, 320, 180); }, 100);
    window.testStream = canvas.captureStream(10);
    window.testAudio = new AudioContext();
    const tone = testAudio.createOscillator();
    const destination = testAudio.createMediaStreamDestination();
    tone.connect(destination); tone.start();
    testStream.addTrack(destination.stream.getAudioTracks()[0]);
    testStream.getTracks().forEach(track => testPeer.addTrack(track, testStream));
    await testPeer.setLocalDescription(await testPeer.createOffer());
    return testPeer.localDescription.toJSON();
  })()`);
  guest.send(JSON.stringify({ type: 'offer', id: rtcId, description: offer }));
  await delay(300);
  const candidates = await evaluate('testCandidates');
  for (const candidate of candidates) guest.send(JSON.stringify({ type: 'candidate', id: rtcId, candidate }));
  let rtcState;
  for (let i = 0; i < 50; i++) {
    rtcState = await evaluate('({ state: testPeer.connectionState, tracks: document.getElementById("remote").srcObject?.getTracks().map(t => t.kind) || [] })');
    if (rtcState.state === 'connected' && rtcState.tracks.length === 2) break;
    await delay(100);
  }
  await rtcQueue;
  assert.equal(rtcState.state, 'connected');
  assert.deepEqual(rtcState.tracks.sort(), ['audio', 'video']);
  assert.equal(await evaluate('$("remote-caption").textContent'), 'Marina <3 está compartilhando');
  const beforeFloating = await evaluate('({ width: innerWidth, height: innerHeight })');
  await evaluate('userMuted = true; updateRemoteAudio(); $("floating").click()');
  await waitFor('document.body.classList.contains("floating") && innerWidth <= 500');
  assert.equal(await evaluate('innerHeight <= 360 && document.querySelector(".toolbar").getBoundingClientRect().bottom <= innerHeight'), true);
  await waitFor('!$("remote").paused && $("remote").videoWidth > 0 && !$("floating").disabled');
  assert.equal(await evaluate('$("remote").srcObject.getTracks().length'), 2);
  await screenshot('preview-floating.png');
  await evaluate('$("floating").click()');
  await waitFor(`!document.body.classList.contains('floating') && innerWidth === ${beforeFloating.width} && innerHeight === ${beforeFloating.height}`);
  await evaluate('$("remote-volume").value = "35"; $("remote-volume").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('$("remote").volume === 0.35 && $("volume-value").textContent === "35%" && !$("audio-controls").hidden'), true);
  await evaluate('$("mute").click()');
  assert.equal(await evaluate('!$("remote").muted && $("mute").getAttribute("aria-pressed") === "false"'), true);
  await evaluate('$("mute").click()');
  guest.send(JSON.stringify({ type: 'stop', id: rtcId }));
  await delay(100);
  assert.equal(await evaluate('document.getElementById("remote").srcObject === null'), true);
  await evaluate('clearInterval(testFrameTimer); testStream.getTracks().forEach(t => t.stop()); testPeer.close(); testAudio.close()');
  console.log('WebRTC: recepção de vídeo + áudio e parada confirmadas.');
  guest.terminate();
  await delay(200);
  assert.equal(await evaluate('connected'), false);
  const pendingReload = await connectGuest();
  await waitFor('$("join-request").open');
  const reloadClosed = once(pendingReload.socket, 'close', { signal: AbortSignal.timeout(5000) });
  await reloadPage();
  await reloadClosed;
  assert.equal(await evaluate('!hosting && !connected && !$("lobby").hidden && !$("join-request").open'), true);
  // Exercise the other side of the protocol with a local test host.
  await delay(200);
  const address = localAddresses().find(validAddress);
  if (address) {
    for (const invalid of ['8.8.8.8', 'share-local://join?address=8.8.8.8']) {
      await evaluate(`$('address').value = ${JSON.stringify(invalid)}; $('join-form').requestSubmit()`);
      await waitFor('!lobbyBusy && !$("join-error").hidden');
      assert.equal(await evaluate('$("retry-join").hidden'), true);
    }
    await evaluate(`$('address').value = ${JSON.stringify(address)}; $('join-form').requestSubmit()`);
    await waitFor('!lobbyBusy && !$("join-error").hidden');
    assert.equal(await evaluate('!$("retry-join").hidden && $("join-help").textContent.includes("Firewall")'), true);
    externalServer = new WebSocketServer({ host: '0.0.0.0', port: 45878 });
    await once(externalServer, 'listening');
    let requestSocket;
    externalServer.on('connection', socket => { requestSocket = socket; socket.once('message', bytes => {
      const msg = JSON.parse(bytes);
      assert.equal(msg.type, 'join-request');
      assert.equal(msg.code, undefined);
      assert.deepEqual(msg.profile, { name: 'Ygor', avatar: 'emma' });
      socket.send(JSON.stringify({ type: 'pending' }));
    }); });
    const ask = async (retry = false) => {
      if (retry) await evaluate('$("retry-join").click()');
      else await evaluate(`$('address').value = ${JSON.stringify(makeInvitation(address, 'Sala convidada'))}; $('join-form').requestSubmit()`);
      await waitFor('lobbyBusy && $("join-progress").textContent.includes("Aguardando")');
      assert.match(await evaluate('$("join-countdown").textContent'), /Expira em \d+ s/);
      assert.equal(await evaluate('$("host").disabled && $("join").disabled && !connected'), true);
    };
    await ask();
    await evaluate('$("cancel-join").click()');
    await waitFor('!lobbyBusy');
    assert.equal(await evaluate('$("join-error").hidden && $("join-pending").hidden && !$("host").disabled'), true);
    await ask();
    requestSocket.send(JSON.stringify({ type: 'rejected', message: 'Seu pedido de entrada foi recusado.' }));
    const refusedClosed = once(requestSocket, 'close');
    await waitFor('!lobbyBusy && !$("join-error").hidden');
    assert.match(await evaluate('$("join-error").textContent'), /recusado/);
    assert.equal(await evaluate('$("retry-join").hidden || $("join-help").hidden'), false);
    await refusedClosed;
    await ask(true);
    requestSocket.send(JSON.stringify({ type: 'joined', name: 'Teste de entrada', profile: { name: 'Pri', avatar: 'priya' } }));
    await waitFor('!lobbyBusy && connected');
    assert.equal(await evaluate('$("room-title").textContent'), 'Teste de entrada');
    assert.equal(await evaluate('$("other-name").textContent'), 'Pri');
    assert.equal(await evaluate('$("invite").hidden && !$("room").hidden'), true);
    const lostHeartbeat = once(requestSocket, 'close', { signal: AbortSignal.timeout(30000) });
    console.log('Verificando perda de conexão sem resposta do anfitrião (25 segundos)…');
    assert.equal((await lostHeartbeat)[0], 1006);
    await waitFor('!connected && !$("lobby").hidden');
    assert.equal(await evaluate('$("participant-count").textContent'), '0/2');
    assert.equal(await evaluate('$("retry-join").hidden'), false);
    assert.equal(await evaluate('$("address").value'), address);
    await ask(true);
    await evaluate('$("cancel-join").click()');
    await waitFor('!lobbyBusy');
    await ask();
    requestSocket.send(JSON.stringify({ type: 'joined', name: 'Sala 0.3.0' }));
    await waitFor('!lobbyBusy && connected');
    assert.equal(await evaluate('$("other-name").textContent'), 'Outra pessoa');
    assert.equal(await evaluate('$("show-chat").disabled && $("show-files").disabled'), true);
    assert.equal(await evaluate('(async () => (await window.canto.action("chat-send", "não enviar para versão antiga")).ok)()'), false);
    await evaluate('$("leave").click()');
    await waitFor('!$("lobby").hidden');
  } else console.log('Sem IP privado local: testes do lado de quem pede entrada não executados.');
  assert.deepEqual(errors, []);
  assert.equal(stderr.includes('UnhandledPromiseRejection'), false, stderr.slice(-2000));
  console.log('OK: perfis, convites, chat e links seguros, recusa de arquivo, janela flutuante, áudio, troca de fonte, captura antiga bloqueada, recarga, autorização e WebRTC.');
})().catch(async error => {
  console.error(error);
  if (debug?.readyState === WebSocket.OPEN) {
    try { console.error('Interface:', await evaluate('({ notice: $("notice-message").textContent, profileError: $("profile-error").textContent, address: $("address").value, connected, floating: document.body.classList.contains("floating"), paused: $("remote").paused, videoWidth: $("remote").videoWidth, rtc: incoming?.pc.connectionState })')); } catch {}
  }
  console.error(stderr.slice(-3000)); process.exitCode = 1;
}).finally(async () => {
  guest?.terminate();
  externalServer?.clients.forEach(socket => socket.terminate());
  externalServer?.close();
  if (debug?.readyState === WebSocket.OPEN) {
    try { debug.send(JSON.stringify({ id: ++nextId, method: 'Browser.close' })); } catch {}
    debug.close();
  }
  child.kill();
  await childClosed;
  await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
