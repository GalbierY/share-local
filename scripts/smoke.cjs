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
  const result = await command('Page.captureScreenshot', { captureBeyondViewport: false });
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
  await evaluate('storePreference({ volume: 35, shareAudio: false, quality: "economy", notifications: false }).then(applyPreferences)');
  await reloadPage();
  assert.equal(await evaluate('$("remote-volume").value === "35" && !$("share-audio").checked && $("quality").value === "economy" && !$("setting-notifications").checked'), true);
  await evaluate('storePreference({ volume: 100, shareAudio: true, quality: "auto", notifications: true }).then(applyPreferences)');
  assert.equal(await evaluate('localProfile.name'), 'Ygor de teste');
  assert.equal(await evaluate('localProfile.avatar'), 'priya');
  await evaluate('$("edit-profile").click()');
  const dom = await command('DOM.getDocument');
  const upload = await command('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#profile-upload' });
  await command('DOM.setFileInputFiles', { nodeId: upload.nodeId, files: [path.join(__dirname, '..', 'test', 'fixtures', 'avatar.png')] });
  await waitFor('Boolean(profilePhoto) && selectedAvatar() === "custom" && !$("photo-editor").hidden');
  await evaluate('$("profile-form").requestSubmit()');
  await waitFor('!$("profile-dialog").open && localProfile.avatar === "custom"');
  const photoProfile = await evaluate('localProfile');
  assert.equal(photoProfile.image.startsWith('data:image/png;base64,'), true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(userData, 'profile.json'), 'utf8')), photoProfile);
  const brokenImage = Buffer.from(photoProfile.image.slice(22), 'base64');
  brokenImage[brokenImage.indexOf('IDAT') + 5] ^= 255;
  assert.equal(await evaluate(`(async () => (await window.canto.action('save-profile', { ...localProfile, image: ${JSON.stringify('data:image/png;base64,' + brokenImage.toString('base64'))} })).ok)()`), false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(userData, 'profile.json'), 'utf8')), photoProfile, 'Foto inválida não substitui o perfil salvo.');
  await fs.writeFile(path.join(userData, 'profile.json'), JSON.stringify({ ...photoProfile, image: 'data:image/png;base64,' + brokenImage.toString('base64') }));
  await reloadPage();
  assert.deepEqual(await evaluate('localProfile'), { name: photoProfile.name, avatar: 'zahir' }, 'Foto salva corrompida preserva o nome com avatar padrão.');
  await fs.writeFile(path.join(userData, 'profile.json'), JSON.stringify(photoProfile));
  await reloadPage();
  assert.equal(await evaluate('$("profile-avatar").src === localProfile.image && $("self-avatar").src === localProfile.image'), true);
  await evaluate('$("edit-profile").click()');
  await waitFor('Boolean(profilePhoto)');
  await evaluate('$("photo-zoom").value = "2"; $("photo-zoom").dispatchEvent(new Event("input")); $("cancel-profile").click()');
  assert.deepEqual(await evaluate('localProfile'), photoProfile, 'Cancelar não altera a foto salva.');
  await evaluate('$("edit-profile").click()');
  await waitFor('Boolean(profilePhoto)');
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 100;
    const context = canvas.getContext('2d');
    context.fillStyle = 'red'; context.fillRect(0, 0, 100, 100);
    context.fillStyle = 'green'; context.fillRect(100, 0, 100, 100);
    context.fillStyle = 'blue'; context.fillRect(200, 0, 100, 100);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    await loadProfilePhoto(new File([blob], 'paisagem.png', { type: 'image/png' }));
  })()`);
  const cropColor = await evaluate(`(() => {
    const context = $('profile-photo').getContext('2d'), result = [];
    for (const value of ['0', '100']) { $('photo-x').value = value; $('photo-x').dispatchEvent(new Event('input')); result.push(Array.from(context.getImageData(64,64,1,1).data)); }
    return result;
  })()`);
  assert.deepEqual(cropColor, [[255, 0, 0, 255], [0, 0, 255, 255]]);
  await screenshot('preview-profile-photo.png');
  assert.equal(await evaluate('$("save-profile").getBoundingClientRect().bottom <= innerHeight && $("profile-dialog").scrollWidth <= $("profile-dialog").clientWidth'), true);
  await command('Emulation.setDeviceMetricsOverride', { width: 760, height: 600, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('$("save-profile").getBoundingClientRect().bottom <= innerHeight && $("profile-dialog").scrollWidth <= $("profile-dialog").clientWidth'), true, 'Editor e botão Salvar cabem na menor janela.');
  await command('Emulation.clearDeviceMetricsOverride');
  await evaluate(`loadProfilePhoto(new File(['<svg/>'], 'imagem.svg', { type: 'image/svg+xml' }))`);
  assert.equal(await evaluate('!$("profile-error").hidden && Boolean(profilePhoto)'), true, 'Arquivo inválido preserva o recorte anterior.');
  await evaluate(`loadProfilePhoto(new File(['imagem quebrada'], 'imagem.png', { type: 'image/png' }))`);
  assert.equal(await evaluate('!$("profile-error").hidden && Boolean(profilePhoto)'), true);
  await evaluate('$("remove-photo").click()');
  assert.equal(await evaluate('selectedAvatar() === "zahir" && !profilePhoto && $("photo-editor").hidden'), true);
  for (const avatar of ['mymelody', 'poporing']) {
    await evaluate(`document.querySelector('input[name="avatar"][value="${avatar}"]').checked = true; document.querySelector('input[name="avatar"][value="${avatar}"]').dispatchEvent(new Event('change')); $('profile-form').requestSubmit()`);
    await waitFor('!$("profile-dialog").open');
    assert.equal(await evaluate('localProfile.avatar'), avatar);
    await evaluate('$("profile-avatar").decode()');
    await evaluate('$("edit-profile").click()');
  }
  await evaluate(`$('profile-name').value = 'Ygor de teste'; document.querySelector('input[name="avatar"][value="priya"]').checked = true; $('profile-form').requestSubmit()`);
  await waitFor('!$("profile-dialog").open');
  await evaluate(`(async () => {
    for (const img of document.querySelectorAll('.avatar-option img')) await img.decode();
  })()`);
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

  await evaluate('window.testNotifications = []; window.canto.onEvent(event => { if (event.type === "desktop-notification") testNotifications.push(event.data); })');
  const accepted = await connectGuest({ type: 'join-request', profile: { name: 'Marina', avatar: 'emma' }, fullProfile: { ...photoProfile, name: 'Marina' }, features: ['profile-images', 'secure-data', 'pause-sharing'] });
  guest = accepted.socket;
  const protectedSignals = [], unprotectedMessages = [];
  guest.on('message', bytes => { const message = JSON.parse(bytes); if (message.channel === 'room') protectedSignals.push(message); else unprotectedMessages.push(message); });
  assert.equal(accepted.reply.type, 'pending');
  await waitFor('$("join-request").open');
  assert.equal(await evaluate('$("request-title").textContent'), 'Marina quer entrar');
  assert.equal(await evaluate('$("request-avatar").src.startsWith("data:image/png;base64,")'), true);
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
  await waitFor('Boolean(secureRoom?.pc.localDescription) && secureRoom.pc.iceGatheringState === "complete"');
  const roomOffer = protectedSignals.find(message => message.type === 'offer');
  assert.ok(roomOffer, 'Sinalização do canal protegido precisa passar pela sala autorizada.');
  await evaluate(`(async () => {
    window.testSecureInbox = []; window.testSecureBinary = [];
    window.testSecurePeer = new RTCPeerConnection({ iceServers: [] });
    testSecurePeer.ondatachannel = event => {
      window.testSecureChannel = event.channel; testSecureChannel.binaryType = 'arraybuffer';
      testSecureChannel.onmessage = message => {
        if (typeof message.data === 'string') testSecureInbox.push(JSON.parse(message.data));
        else { testSecureBinary.push(Array.from(new Uint8Array(message.data).slice(4))); testSecureChannel.send(JSON.stringify({ type: 'transport-ack', sequence: new DataView(message.data).getUint32(0) })); }
      };
    };
    await testSecurePeer.setRemoteDescription(${JSON.stringify(roomOffer.description)});
    for (const candidate of ${JSON.stringify(protectedSignals.filter(message => message.type === 'candidate').map(message => message.candidate))}) await testSecurePeer.addIceCandidate(candidate);
    await testSecurePeer.setLocalDescription(await testSecurePeer.createAnswer());
  })()`);
  await waitFor('testSecurePeer.iceGatheringState === "complete"');
  guest.send(JSON.stringify({ type: 'answer', id: roomOffer.id, channel: 'room', description: await evaluate('testSecurePeer.localDescription.toJSON()') }));
  await waitFor('secureReady && testSecureChannel?.readyState === "open"');
  assert.equal(await evaluate('secureRoom.pc.sctp.transport.state'), 'connected');
  assert.match(await evaluate('$("secure-status").textContent'), /[A-F0-9]{4} [A-F0-9]{4} [A-F0-9]{4}/);
  assert.equal(await evaluate(`(async () => {
    const fingerprints = [testSecurePeer.localDescription, testSecurePeer.remoteDescription].map(description => description.sdp.match(/a=fingerprint:sha-256 (.+)/i)[1].trim()).sort();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprints.join('|')));
    const code = Array.from(new Uint8Array(hash).slice(0, 16), byte => byte.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{4}/g).join(' ');
    return $('secure-status').textContent.endsWith(code);
  })()`), true, 'As duas pontas precisam exibir o mesmo código do canal protegido.');
  assert.equal(await evaluate('testNotifications.some(notification => notification.title === "Pedido de entrada")'), true);
  assert.equal(await evaluate('connected'), true);
  assert.equal(await evaluate('$("participant-count").textContent'), '2/2');
  assert.equal(await evaluate('$("other-name").textContent'), 'Marina');
  assert.equal(await evaluate('$("other-avatar").src.startsWith("data:image/png;base64,")'), true);
  guest.send(JSON.stringify({ type: 'profile', profile: { name: 'Marina <3', avatar: 'zahir' } }));
  await waitFor('$("other-name").textContent === "Marina <3"');
  guest.send(JSON.stringify({ type: 'profile', profile: { name: 'Inválido', avatar: 'https://evil.test/avatar' } }));
  const changedPhoto = once(guest, 'message');
  await evaluate(`(async () => {
    showProfile();
    const bytes = Uint8Array.from(atob(${JSON.stringify(photoProfile.image.slice(22))}), char => char.charCodeAt(0));
    await loadProfilePhoto(new File([bytes], 'perfil.png', { type: 'image/png' }));
    $('profile-name').value = 'Ygor'; $('profile-form').requestSubmit();
  })()`);
  const photoMessage = JSON.parse((await changedPhoto)[0]);
  assert.equal(photoMessage.profile.avatar, 'custom');
  assert.equal(photoMessage.profile.image.startsWith('data:image/png;base64,'), true);
  await waitFor('!$("profile-dialog").open');
  await evaluate('$("edit-profile").click()');
  const changedProfile = once(guest, 'message');
  await evaluate(`$('profile-name').value = 'Ygor'; document.querySelector('input[name="avatar"][value="emma"]').checked = true; $('profile-form').requestSubmit()`);
  assert.deepEqual(JSON.parse((await changedProfile)[0]), { type: 'profile', profile: { name: 'Ygor', avatar: 'emma' } });
  await waitFor('!$("profile-dialog").open');
  assert.equal(await evaluate('$("other-name").textContent'), 'Marina <3');
  assert.equal(await evaluate('$("show-chat").disabled || $("show-files").disabled'), false);
  const chatId = '11111111-1234-1234-1234-123456789abc';
  await evaluate('(async () => { await storePreference({ notifications: false }).then(applyPreferences); testNotifications.length = 0; })()');
  guest.send(JSON.stringify({ type: 'chat', id: chatId, text: 'Não aceitar conversa sem criptografia' }));
  await delay(100);
  assert.equal(await evaluate('$("chat-messages").children.length'), 0);
  await evaluate(`testSecureChannel.send(${JSON.stringify(JSON.stringify({ type: 'chat', id: chatId, text: 'Olá <img src=x>! Veja https://example.com/video' }))})`);
  await waitFor('$("chat-messages").children.length === 1');
  assert.equal(await evaluate('testNotifications.length'), 0);
  await evaluate('storePreference({ notifications: true }).then(applyPreferences)');
  assert.equal(await evaluate('$("chat-messages").querySelectorAll("img,script").length'), 0);
  assert.equal(await evaluate('$("chat-messages").querySelector("a").href'), 'https://example.com/video');
  assert.equal(await evaluate('$("chat-badge").hidden'), false);
  await evaluate('$("show-chat").click()');
  await waitFor('!$("room-tools").hidden && !$("chat-panel").hidden');
  assert.equal(await evaluate('$("chat-badge").hidden'), true);
  await evaluate('$("chat-input").value = "Vamos assistir 🐈"; $("chat-form").requestSubmit()');
  await waitFor('testSecureInbox.some(message => message.type === "chat")');
  assert.equal(await evaluate('testSecureInbox.find(message => message.type === "chat").text'), 'Vamos assistir 🐈');
  assert.equal(unprotectedMessages.some(message => message.type === 'chat'), false);
  await waitFor('$("chat-messages").children.length === 2');
  await screenshot('preview-chat.png');
  assert.equal(await evaluate('(async () => (await window.canto.action("open-link", "file:///C:/Windows")).ok)()'), false);
  const fileId = '22222222-1234-1234-1234-123456789abc';
  await evaluate(`testSecureChannel.send(${JSON.stringify(JSON.stringify({ type: 'file-offer', id: fileId, name: 'foto de férias.png', size: 4096 }))})`);
  await waitFor('!$("files-badge").hidden');
  assert.equal(await evaluate('testNotifications.some(notification => notification.title === "Arquivo aguardando aceite")'), true);
  await evaluate('$("show-files").click()');
  await waitFor('!$("files-panel").hidden');
  assert.equal(await evaluate('$("file-list").querySelector(".transfer-name").textContent'), 'foto de férias.png');
  await screenshot('preview-files.png');
  await evaluate('Array.from($("file-list").querySelectorAll("button")).find(button => button.textContent === "Recusar").click()');
  await waitFor('testSecureInbox.some(message => message.type === "file-reject")');
  assert.equal(unprotectedMessages.some(message => message.type?.startsWith('file-')), false);
  await waitFor('$("file-list").textContent.includes("Arquivo recusado")');
  const extraSource = path.join(userData, 'segundo-arquivo.txt');
  await fs.writeFile(extraSource, 'Segundo arquivo para testar a fila criptografada.');
  await evaluate(`(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'smoke-file-drop'; document.body.append(input); })()`);
  const dropDOM = await command('DOM.getDocument');
  const dropInput = await command('DOM.querySelector', { nodeId: dropDOM.root.nodeId, selector: '#smoke-file-drop' });
  await command('DOM.setFileInputFiles', { nodeId: dropInput.nodeId, files: [path.join(__dirname, '..', 'test', 'fixtures', 'avatar.png'), extraSource] });
  await evaluate(`window.canto.dropFiles(Array.from($('smoke-file-drop').files))`);
  await waitFor('testSecureInbox.some(message => message.type === "file-offer" && message.name === "avatar.png")');
  assert.equal(await evaluate('!$("file-queue-wrap").hidden && $("file-queue-count").textContent'), '1 na fila');
  const queuedOffer = await evaluate('testSecureInbox.find(message => message.type === "file-offer" && message.name === "avatar.png")');
  await evaluate(`testSecureChannel.send(${JSON.stringify(JSON.stringify({ type: 'file-accept', id: queuedOffer.id }))})`);
  await waitFor('testSecureInbox.some(message => message.type === "file-end")');
  const transferred = Buffer.concat((await evaluate('testSecureBinary')).map(packet => Buffer.from(packet.slice(36))));
  assert.deepEqual(transferred, await fs.readFile(path.join(__dirname, '..', 'test', 'fixtures', 'avatar.png')));
  assert.equal((await evaluate('testSecureInbox.find(message => message.type === "file-end")')).sha256, require('node:crypto').createHash('sha256').update(transferred).digest('hex'));
  await evaluate(`testSecureChannel.send(${JSON.stringify(JSON.stringify({ type: 'file-complete', id: queuedOffer.id }))})`);
  await waitFor('testSecureInbox.some(message => message.type === "file-offer" && message.name === "segundo-arquivo.txt")');
  const secondOffer = await evaluate('testSecureInbox.find(message => message.type === "file-offer" && message.name === "segundo-arquivo.txt")');
  await evaluate(`testSecureChannel.send(${JSON.stringify(JSON.stringify({ type: 'file-reject', id: secondOffer.id }))})`);
  await waitFor('$("file-queue-wrap").hidden');
  assert.equal(unprotectedMessages.some(message => message.type?.startsWith('file-')), false, 'Metadados e conteúdo dos arquivos não passam pelo WebSocket.');
  await evaluate('$("smoke-file-drop").remove()');
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
  await evaluate('$("pause-share").click()');
  assert.equal(await evaluate('outgoing.paused && outgoing.stream.getTracks().every(track => !track.enabled) && $("change-source").disabled'), true);
  await evaluate('$("pause-share").click()');
  assert.equal(await evaluate('!outgoing.paused && outgoing.stream.getTracks().every(track => track.enabled)'), true);
  await evaluate('changeQuality("economy")');
  assert.equal(await evaluate('outgoing.videoSender.getParameters().encodings[0].maxBitrate'), 1200000);
  assert.equal(await evaluate('outgoing.stream.getVideoTracks()[0].getSettings().frameRate <= 20'), true);
  await evaluate('changeQuality("auto")');
  await evaluate('window.originalShare = outgoing; window.originalTracks = outgoing.stream.getTracks(); $("change-source").click()');
  await waitFor('$("picker").open');
  await evaluate('$("share-audio").checked = true; ($( "sources").children[1] || $("sources").firstElementChild).click()');
  await waitFor('!capturePending && outgoing.stream.getAudioTracks().length > 0');
  await evaluate('$("pause-share").click()');
  assert.equal(await evaluate('outgoing.stream.getTracks().every(track => !track.enabled) && !$("remote").muted'), true, 'Pausar bloqueia imagem e áudio, liberando o som recebido.');
  await evaluate('$("pause-share").click()');
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
    window.beforeCancelCapture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async options => {
      window.cancelledCaptureStream = await beforeCancelCapture(options);
      await new Promise(resolve => { window.finishCancelledCapture = resolve; });
      return cancelledCaptureStream;
    };
    window.cancelledCapture = startSharing(captureSources.find(source => source.id.startsWith('screen:')));
  })()`);
  await waitFor('Boolean(window.cancelledCaptureStream) && capturePending');
  assert.equal(await evaluate(`(async () => {
    handleShortcut('stop'); finishCancelledCapture(); await cancelledCapture;
    navigator.mediaDevices.getDisplayMedia = beforeCancelCapture;
    return !outgoing && cancelledCaptureStream.getTracks().every(track => track.readyState === 'ended');
  })()`), true, 'Parar pelo atalho também cancela uma captura ainda em preparação.');
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
  await evaluate('$("edit-profile").click()');
  await evaluate(`document.querySelector('input[name="avatar"][value="poporing"]').checked = true; $('profile-form').requestSubmit()`);
  await waitFor('!$("profile-dialog").open');
  const reconnected = await connectGuest({ type: 'join-request', profile: { name: 'Marina <3', avatar: 'zahir' }, features: ['chat', 'files'] });
  guest = reconnected.socket;
  await waitFor('$("join-request").open');
  const reapproved = once(guest, 'message');
  await evaluate('$("approve-join").click()');
  const legacyApproval = JSON.parse((await reapproved)[0]);
  assert.equal(legacyApproval.type, 'joined');
  assert.deepEqual(legacyApproval.profile, { name: 'Ygor', avatar: 'zahir' }, 'Versão antiga recebe um avatar conhecido.');
  await waitFor('connected');
  assert.equal(await evaluate('$("notice").hidden'), true);
  const legacyChange = once(guest, 'message');
  await evaluate('$("edit-profile").click()');
  await evaluate(`document.querySelector('input[name="avatar"][value="emma"]').checked = true; $('profile-form').requestSubmit()`);
  assert.deepEqual(JSON.parse((await legacyChange)[0]), { type: 'profile', profile: { name: 'Ygor', avatar: 'emma' } });
  await waitFor('!$("profile-dialog").open');
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
  assert.equal(await evaluate('innerHeight <= 540 && document.querySelector(".toolbar").getBoundingClientRect().bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth'), true);
  await waitFor('!$("remote").paused && $("remote").videoWidth > 0 && !$("floating").disabled');
  assert.equal(await evaluate('$("remote").srcObject.getTracks().length'), 2);
  await screenshot('preview-floating.png');
  await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 300, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('document.querySelector(".toolbar").getBoundingClientRect().bottom <= innerHeight && $("room").scrollWidth <= $("room").clientWidth'), true, 'Controles continuam acessíveis no painel reduzido.');
  await command('Emulation.clearDeviceMetricsOverride');
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
    requestSocket.send(JSON.stringify({ type: 'joined', name: 'Perfil corrompido', profile: { name: 'Pessoa', avatar: 'custom', image: 'data:image/png;base64,' + brokenImage.toString('base64') }, features: ['profile-images'] }));
    await waitFor('!lobbyBusy && !$("join-error").hidden');
    assert.equal(await evaluate('connected'), false, 'Uma foto corrompida não prende a interface em um pedido sem fim.');
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
    assert.equal(await evaluate('$("reconnect-banner").hidden'), false);
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
    assert.equal(await evaluate('$("reconnect-banner").hidden'), true);
    await ask();
    const modernSignals = [];
    requestSocket.on('message', bytes => { const message = JSON.parse(bytes); if (message.channel === 'room') modernSignals.push(message); });
    requestSocket.send(JSON.stringify({ type: 'joined', name: 'Sala protegida', profile: { name: 'Pri', avatar: 'poporing' }, features: ['profile-images', 'secure-data', 'pause-sharing'] }));
    await waitFor('connected && !lobbyBusy');
    const modernId = '87654321-1234-1234-1234-123456789abc';
    const modernOffer = await evaluate(`(async () => {
      window.testHostCandidates = []; window.testHostInbox = [];
      window.testHostPeer = new RTCPeerConnection({ iceServers: [] });
      testHostPeer.onicecandidate = event => { if (event.candidate) testHostCandidates.push(event.candidate.toJSON()); };
      window.testHostChannel = testHostPeer.createDataChannel('share-local-secure-v1', { ordered: true });
      testHostChannel.onmessage = event => testHostInbox.push(JSON.parse(event.data));
      await testHostPeer.setLocalDescription(await testHostPeer.createOffer());
      return testHostPeer.localDescription.toJSON();
    })()`);
    await waitFor('testHostPeer.iceGatheringState === "complete"');
    for (const candidate of await evaluate('testHostCandidates')) requestSocket.send(JSON.stringify({ type: 'candidate', channel: 'room', id: modernId, candidate }));
    requestSocket.send(JSON.stringify({ type: 'offer', channel: 'room', id: modernId, description: modernOffer }));
    await waitFor('Boolean(secureRoom?.pc.localDescription) && secureRoom.pc.iceGatheringState === "complete"');
    const modernAnswer = modernSignals.find(message => message.type === 'answer');
    assert.ok(modernAnswer);
    await evaluate(`(async () => { await testHostPeer.setRemoteDescription(${JSON.stringify(modernAnswer.description)}); for (const candidate of ${JSON.stringify(modernSignals.filter(message => message.type === 'candidate').map(message => message.candidate))}) await testHostPeer.addIceCandidate(candidate); })()`);
    await waitFor('secureReady && testHostChannel.readyState === "open"');
    assert.equal(await evaluate('secureRoom.pc.sctp.transport.state'), 'connected');
    const restartOffset = modernSignals.length;
    await evaluate('(async () => { window.originalSecure = secureRoom; testHostCandidates = []; testHostPeer.restartIce(); await testHostPeer.setLocalDescription(await testHostPeer.createOffer({ iceRestart: true })); })()');
    await waitFor('testHostPeer.iceGatheringState === "complete"');
    requestSocket.send(JSON.stringify({ type: 'offer', channel: 'room', id: modernId, description: await evaluate('testHostPeer.localDescription.toJSON()') }));
    for (let i = 0; i < 100 && !modernSignals.slice(restartOffset).some(message => message.type === 'answer'); i++) await delay(50);
    await waitFor('secureRoom.pc.iceGatheringState === "complete"');
    const restarted = modernSignals.slice(restartOffset), restartedAnswer = restarted.find(message => message.type === 'answer');
    assert.ok(restartedAnswer);
    await evaluate(`(async () => { await testHostPeer.setRemoteDescription(${JSON.stringify(restartedAnswer.description)}); for (const candidate of ${JSON.stringify(restarted.filter(message => message.type === 'candidate').map(message => message.candidate))}) await testHostPeer.addIceCandidate(candidate); })()`);
    await waitFor('secureReady && testHostPeer.connectionState === "connected"');
    assert.equal(await evaluate('secureRoom === originalSecure'), true, 'Recuperação ICE preserva a sala e o canal protegido.');
    await evaluate(`testHostChannel.send(${JSON.stringify(JSON.stringify({ type: 'chat', id: '77777777-1234-1234-1234-123456789abc', text: 'Conversa após reconectar' }))})`);
    await waitFor('$("chat-messages").textContent.includes("Conversa após reconectar")');
    await evaluate('$("window-minimize").click()');
    await waitFor('document.body.classList.contains("floating") && innerWidth <= 360');
    await evaluate('storePreference({ overlayOpacity: 0.85, overlaySide: "left" }).then(applyPreferences)');
    await screenshot('preview-overlay-secure.png');
    const savedPreferences = JSON.parse(await fs.readFile(path.join(userData, 'preferences.json'), 'utf8'));
    assert.equal(savedPreferences.overlayOpacity, 0.85); assert.equal(savedPreferences.overlaySide, 'left');
    assert.ok(savedPreferences.window.width >= 760 && savedPreferences.window.height >= 600);
    await evaluate('action("floating", false)');
    await waitFor('!document.body.classList.contains("floating")');
    await evaluate('$("open-settings").click()'); await screenshot('preview-settings.png');
    await evaluate('$("close-settings").click(); $("leave").click(); testHostPeer.close()');
    await waitFor('!connected && !$("lobby").hidden');
  } else console.log('Sem IP privado local: testes do lado de quem pede entrada não executados.');
  assert.deepEqual(errors, []);
  assert.equal(stderr.includes('UnhandledPromiseRejection'), false, stderr.slice(-2000));
  console.log('OK: perfis, preferências, notificações, canal DTLS nos dois sentidos, código de segurança, ICE restart, fila e conteúdo dos arquivos, pausa e cancelamento, qualidade, painel lateral, compatibilidade, autorização e WebRTC.');
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
