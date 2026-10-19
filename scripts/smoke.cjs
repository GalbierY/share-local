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
async function connectGuest(code) {
  const socket = new WebSocket('ws://127.0.0.1:45878');
  socket.on('error', () => {});
  await once(socket, 'open');
  const reply = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'join', code }));
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
  assert.equal(await evaluate('Boolean(window.canto) && typeof require === "undefined"'), true);
  assert.equal(await evaluate('document.title'), 'Share Local');
  assert.equal(await evaluate('document.querySelectorAll(".hero-cats img").length'), 3);
  assert.equal(await evaluate('document.querySelector(".hero-cats img[src*=emma]").alt.includes("sem rabinho")'), true);
  const updateStatus = await evaluate('(async () => (await action("update-state")).status)()');
  if (packaged) assert.ok(['idle', 'checking', 'current', 'error'].includes(updateStatus), `Atualizador empacotado indisponível: ${updateStatus}`);
  else assert.equal(updateStatus, 'development');
  await fs.mkdir(path.join(__dirname, '..', 'release'), { recursive: true });
  await delay(500);
  const screenshot = await command('Page.captureScreenshot', { captureBeyondViewport: true });
  await fs.writeFile(path.join(__dirname, '..', 'release', 'preview.png'), Buffer.from(screenshot.data, 'base64'));
  const room = await evaluate('action("host", "Sala de teste")');
  assert.match(room.code, /^\d{6}$/);
  const wrong = await connectGuest('000000');
  assert.equal(wrong.reply.type, 'rejected');
  wrong.socket.terminate();
  const accepted = await connectGuest(room.code);
  guest = accepted.socket;
  assert.equal(accepted.reply.type, 'joined');
  await delay(100);
  assert.equal(await evaluate('connected'), true);
  const third = new WebSocket('ws://127.0.0.1:45878');
  third.on('error', () => {});
  const [closeCode] = await once(third, 'close');
  assert.equal(closeCode, 1008);
  const received = once(guest, 'message');
  await evaluate('action("signal", { type: "stop", id: "12345678-1234-1234-1234-123456789abc" })');
  assert.equal(JSON.parse((await received)[0]).type, 'stop');
  const sources = await evaluate('action("sources")');
  assert.ok(sources.length > 0);
  const capture = await evaluate(`(async () => {
    await action('select-source', ${JSON.stringify(sources[0].id)});
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const result = { video: stream.getVideoTracks().length, audio: stream.getAudioTracks().length };
    stream.getTracks().forEach(track => track.stop());
    return result;
  })()`);
  assert.equal(capture.video, 1);
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
  guest.send(JSON.stringify({ type: 'stop', id: rtcId }));
  await delay(100);
  assert.equal(await evaluate('document.getElementById("remote").srcObject === null'), true);
  await evaluate('testStream.getTracks().forEach(t => t.stop()); testPeer.close(); testAudio.close()');
  console.log('WebRTC: recepção de vídeo + áudio e parada confirmadas.');
  guest.terminate();
  await delay(200);
  assert.equal(await evaluate('connected'), false);
  await evaluate('action("leave")');
  // Exercise the other side of the protocol with a local test host.
  await delay(200);
  const address = localAddresses().find(validAddress);
  if (address) {
    externalServer = new WebSocketServer({ host: '0.0.0.0', port: 45878 });
    await once(externalServer, 'listening');
    externalServer.on('connection', socket => socket.once('message', bytes => {
      const msg = JSON.parse(bytes);
      assert.equal(msg.code, '123456');
      socket.send(JSON.stringify({ type: 'joined', name: 'Teste de entrada' }));
    }));
    const joined = await evaluate(`action('join', { address: ${JSON.stringify(address)}, code: '123456' })`);
    assert.equal(joined.name, 'Teste de entrada');
    await evaluate('action("leave")');
  }
  assert.deepEqual(errors, []);
  console.log('OK: isolamento, abertura, código incorreto, entrada, limite de participantes, sinalização, captura, WebRTC e desconexão.');
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
