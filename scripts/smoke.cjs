const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WebSocket, WebSocketServer } = require('ws');
const { localAddresses, validAddress } = require('../src/protocol.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 19337;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.CANTO_TEST_EXECUTABLE;
const child = spawn(packaged || require('electron'), ['.', '--smoke-test', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
  cwd: path.join(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
});
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
  const result = await command('Page.captureScreenshot', { captureBeyondViewport: true });
  await fs.writeFile(path.join(__dirname, '..', 'release', name), Buffer.from(result.data, 'base64'));
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
  await evaluate('$("copy-invite").click()');
  await waitFor('!$("copy-invite").disabled');
  assert.match(await evaluate('$("notice-message").textContent'), /Convite copiado/);
  await evaluate('$("dismiss-notice").click()');
  assert.equal(await evaluate('$("notice").hidden'), true);
  await screenshot('preview-room.png');

  const legacy = await connectGuest({ type: 'join', code: '123456' });
  assert.equal(legacy.reply.type, 'rejected');
  assert.match(legacy.reply.message, /Atualize/);
  legacy.socket.terminate();
  const denied = await connectGuest();
  assert.equal(denied.reply.type, 'pending');
  await waitFor('$("join-request").open');
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

  const accepted = await connectGuest();
  guest = accepted.socket;
  assert.equal(accepted.reply.type, 'pending');
  await waitFor('$("join-request").open');
  assert.equal(await evaluate(`(async () => (await window.canto.action('respond-join', { id: ${JSON.stringify(staleId)}, approve: true })).ok)()`), false);
  assert.equal(await evaluate('connected'), false);
  await screenshot('preview-request.png');
  const pendingThird = await connectGuest();
  assert.equal(pendingThird.reply.type, 'rejected');
  pendingThird.socket.terminate();
  const approved = once(guest, 'message');
  await evaluate('$("approve-join").click()');
  assert.equal(JSON.parse((await approved)[0]).type, 'joined');
  await waitFor('connected && !$("join-request").open');
  assert.equal(await evaluate('connected'), true);
  assert.equal(await evaluate('$("participant-count").textContent'), '2/2');
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
  await evaluate('$("filter-screens").click(); $("sources").firstElementChild.click()');
  await waitFor('Boolean(outgoing?.pc.localDescription) && !capturePending');
  const capture = await evaluate('({ video: outgoing.stream.getVideoTracks().length, audio: outgoing.stream.getAudioTracks().length })');
  assert.equal(capture.video, 1);
  assert.equal(await evaluate('!$("preview-wrap").hidden && $("share").hidden && !$("stop").hidden'), true);
  await evaluate('window.capturedTracks = outgoing.stream.getTracks(); $("stop").click()');
  await waitFor('!outgoing');
  assert.equal(await evaluate('capturedTracks.every(track => track.readyState === "ended") && $("preview-wrap").hidden && !$("share").hidden'), true);
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
  await evaluate('$("mute").click()');
  assert.equal(await evaluate('$("remote").muted && $("mute").getAttribute("aria-pressed") === "true"'), true);
  await evaluate('$("mute").click()');
  guest.send(JSON.stringify({ type: 'stop', id: rtcId }));
  await delay(100);
  assert.equal(await evaluate('document.getElementById("remote").srcObject === null'), true);
  await evaluate('testStream.getTracks().forEach(t => t.stop()); testPeer.close(); testAudio.close()');
  console.log('WebRTC: recepção de vídeo + áudio e parada confirmadas.');
  guest.terminate();
  await delay(200);
  assert.equal(await evaluate('connected'), false);
  await evaluate('$("leave").click()');
  await waitFor('!$("lobby").hidden');
  // Exercise the other side of the protocol with a local test host.
  await delay(200);
  const address = localAddresses().find(validAddress);
  if (address) {
    externalServer = new WebSocketServer({ host: '0.0.0.0', port: 45878 });
    await once(externalServer, 'listening');
    let requestSocket;
    externalServer.on('connection', socket => { requestSocket = socket; socket.once('message', bytes => {
      const msg = JSON.parse(bytes);
      assert.equal(msg.type, 'join-request');
      assert.equal(msg.code, undefined);
      socket.send(JSON.stringify({ type: 'pending' }));
    }); });
    const ask = async () => {
      await evaluate(`$('address').value = ${JSON.stringify(address)}; $('join-form').requestSubmit()`);
      await waitFor('lobbyBusy && $("join-progress").textContent.includes("Aguardando")');
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
    await refusedClosed;
    await ask();
    requestSocket.send(JSON.stringify({ type: 'joined', name: 'Teste de entrada' }));
    await waitFor('!lobbyBusy && connected');
    assert.equal(await evaluate('$("room-title").textContent'), 'Teste de entrada');
    assert.equal(await evaluate('$("invite").hidden && !$("room").hidden'), true);
    requestSocket.close();
    await waitFor('!connected && !$("lobby").hidden');
    assert.equal(await evaluate('$("participant-count").textContent'), '0/2');
  } else console.log('Sem IP privado local: testes do lado de quem pede entrada não executados.');
  assert.deepEqual(errors, []);
  console.log('OK: isolamento, teclado, layout, convite, autorização, recusa, cancelamento, expiração, pedidos antigos, limite de participantes, captura, WebRTC e desconexão.');
})().catch(error => { console.error(error); console.error(stderr.slice(-3000)); process.exitCode = 1; }).finally(async () => {
  guest?.terminate();
  externalServer?.clients.forEach(socket => socket.terminate());
  externalServer?.close();
  if (debug?.readyState === WebSocket.OPEN) {
    try { debug.send(JSON.stringify({ id: ++nextId, method: 'Browser.close' })); } catch {}
    debug.close();
  }
  child.kill();
});
