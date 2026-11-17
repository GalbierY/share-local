const { app, BrowserWindow, ipcMain, desktopCapturer, session, clipboard, dialog, shell, screen } = require('electron');
const { WebSocketServer, WebSocket } = require('ws');
const { randomUUID } = require('node:crypto');
const dgram = require('node:dgram');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { validSignal, localAddresses, validAddress, validProfile } = require('./protocol.cjs');
const { readProfile, saveProfile } = require('./profile.cjs');
const { parseInvitation, makeInvitation, invitationArgument } = require('./invitations.cjs');
const { startUpdates } = require('./updates.cjs');
const { ROOM_FEATURES, readFeatures, validChat, validFileMessage, safeExternalURL } = require('./room-protocol.cjs');
const { createFileTransfers } = require('./files.cjs');
const PORT = 45878, DISCOVERY = 45879;
const argumentEnd = process.argv.indexOf('--');
const launchOptions = argumentEnd < 0 ? process.argv : process.argv.slice(0, argumentEnd);
const smokeTest = launchOptions.includes('--smoke-test');
const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
let win, server, peer, client, udp, announcement, heartbeat, room, selectedSource, pendingJoin;
let closing = false;
let updates;
let files, floatingBounds, remoteFeatures = [];
let profile, remoteProfile, profileFile, queuedInvite, inviteError, readyForInvites = false;
const fallbackProfile = { name: 'Outra pessoa', avatar: 'zahir' };
const connectionError = (message, code) => Object.assign(new Error(message), { code });
const sendUI = (type, data) => { if (win && !win.isDestroyed()) win.webContents.send('event', { type, data }); };
const activeSocket = () => remoteProfile && (peer || client);
function sendRoomMessage(message) {
  const socket = activeSocket();
  if (socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('A outra pessoa desconectou.'));
  if (socket.bufferedAmount > 1024 * 1024) return Promise.reject(new Error('A conexão está congestionada. Aguarde um instante e tente novamente.'));
  return new Promise((resolve, reject) => socket.send(Buffer.isBuffer(message) ? message : JSON.stringify(message), error => error ? reject(error) : resolve()));
}
function receiveRoomMessage(message) {
  if (remoteFeatures.includes('chat') && validChat(message)) sendUI('chat-message', { id: message.id, text: message.text, profile: remoteProfile, at: Date.now() });
  else if (remoteFeatures.includes('files') && validFileMessage(message)) files.receive(message).catch(() => sendUI('network-error', 'Não foi possível concluir a transferência. Tente novamente.'));
}
function setFloating(value) {
  if (!win || win.isDestroyed()) { floatingBounds = undefined; return false; }
  if (value && !floatingBounds) {
    floatingBounds = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    if (win.isMaximized()) win.unmaximize();
    win.setMinimumSize(320, 220);
    win.setAlwaysOnTop(true, 'floating');
    win.setBounds({ x: area.x + area.width - 500, y: area.y + area.height - 350, width: 480, height: 320 });
  } else if (!value && floatingBounds) {
    const previous = floatingBounds;
    floatingBounds = undefined;
    win.setAlwaysOnTop(false);
    win.setMinimumSize(760, 600);
    win.setBounds(previous.bounds);
    if (previous.maximized) win.maximize();
  }
  sendUI('floating-state', Boolean(floatingBounds));
  return Boolean(floatingBounds);
}
function receiveInvitation(raw) {
  try {
    const invitation = parseInvitation(raw);
    if (room || client || peer) return sendUI('invitation-warning', 'Você já está em uma sala ou enviando um pedido. Saia ou cancele antes de abrir outro convite.');
    inviteError = undefined;
    if (readyForInvites) sendUI('invitation', invitation);
    else queuedInvite = invitation;
  } catch (error) {
    if (readyForInvites) sendUI('invitation-warning', error.message);
    else inviteError = error.message;
  }
}
function clearPendingJoin(socket) {
  if (!pendingJoin || pendingJoin.socket !== socket) return;
  clearTimeout(pendingJoin.timeout);
  const { id } = pendingJoin;
  pendingJoin = undefined;
  sendUI('join-request-ended', { id });
}
function reset() {
  const cleanup = files?.reset();
  setFloating(false);
  clearInterval(announcement);
  clearInterval(heartbeat);
  announcement = undefined;
  room = undefined;
  selectedSource = undefined;
  remoteProfile = undefined;
  remoteFeatures = [];
  const oldPeer = peer, oldClient = client, oldServer = server;
  if (pendingJoin) clearPendingJoin(pendingJoin.socket);
  peer = client = server = undefined;
  oldPeer?.terminate();
  oldClient?.terminate();
  oldServer?.clients.forEach(socket => socket.terminate());
  oldServer?.close();
  return cleanup;
}
function announce() {
  if (!room || !udp) return;
  const packet = Buffer.from(JSON.stringify({ app: 'nosso-canto-v1', name: room.name }));
  udp.send(packet, DISCOVERY, '255.255.255.255', () => {});
}
function startDiscovery() {
  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', () => sendUI('discovery-warning', 'Busca automática indisponível. Use o IP exibido no outro computador.'));
  udp.on('message', (bytes, info) => {
    if (bytes.length > 512 || localAddresses().includes(info.address) || !validAddress(info.address)) return;
    try {
      const data = JSON.parse(bytes);
      if (data.app === 'nosso-canto-v1' && typeof data.name === 'string') sendUI('discovered', { address: info.address, name: data.name.slice(0, 40) });
    } catch {}
  });
  udp.bind(DISCOVERY, '0.0.0.0', () => { udp.setBroadcast(true); });
}
async function host(name) {
  if (!profile) throw new Error('Salve seu nome e avatar antes de abrir a sala.');
  reset();
  const hostServer = new WebSocketServer({ port: PORT, host: '0.0.0.0', maxPayload: 128 * 1024, perMessageDeflate: false });
  server = hostServer;
  await new Promise((resolve, reject) => { hostServer.once('listening', resolve); hostServer.once('error', reject); });
  room = { name: String(name || '').trim().slice(0, 40) || 'Nosso cantinho', addresses: localAddresses().filter(validAddress) };
  const attempts = new Map();
  hostServer.on('connection', (socket, req) => {
    socket.on('error', () => {});
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    // shortcut: limite de tentativas em memória por sala; persistir se houver acesso fora da rede doméstica.
    for (const [key, value] of attempts) if (now - value.start > 60000) attempts.delete(key);
    const attempt = attempts.get(ip) || { count: 0, start: now };
    attempt.count++;
    attempts.set(ip, attempt);
    if (attempt.count > 8 || attempts.size > 256 || peer || pendingJoin) {
      socket.send(JSON.stringify({ type: 'rejected', code: peer ? 'ROOM_FULL' : pendingJoin ? 'ROOM_BUSY' : 'TOO_MANY_ATTEMPTS', message: peer ? 'A sala já está completa.' : pendingJoin ? 'Há outro pedido de entrada em andamento. Tente novamente em instantes.' : 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.' }));
      return socket.close(1008);
    }
    let authenticated = false;
    const timeout = setTimeout(() => socket.close(1008, 'Tempo de entrada esgotado.'), 5000);
    socket.on('message', (bytes, binary) => {
      if (binary) {
        if (authenticated && peer === socket) files.receiveChunk(bytes, socket);
        else socket.close(1008, 'Entrada não autorizada.');
        return;
      }
      try {
        const msg = JSON.parse(bytes);
        if (!authenticated) {
          if (msg.type !== 'join-request' || peer || pendingJoin || (msg.profile !== undefined && !validProfile(msg.profile))) {
            socket.send(JSON.stringify({ type: 'rejected', message: msg.type === 'join' ? 'Esta sala usa autorização de entrada. Atualize o Share Local nos dois computadores.' : 'Pedido de entrada inválido ou sala ocupada.' }));
            return socket.close(1008);
          }
          clearTimeout(timeout);
          const id = randomUUID();
          const guestProfile = msg.profile ? { name: msg.profile.name.trim(), avatar: msg.profile.avatar } : fallbackProfile;
          const reject = (message, code) => { socket.send(JSON.stringify({ type: 'rejected', message, code })); socket.close(1008); };
          pendingJoin = { id, socket,
            timeout: setTimeout(() => { clearPendingJoin(socket); reject('O pedido expirou sem resposta. Peça para entrar novamente.', 'EXPIRED'); }, 60000),
            respond: approve => {
              if (!approve) return reject('Seu pedido de entrada foi recusado.', 'DECLINED');
              authenticated = true;
              peer = socket;
              socket.alive = true;
              remoteProfile = guestProfile;
              remoteFeatures = readFeatures(msg.features);
              socket.send(JSON.stringify({ type: 'joined', name: room.name, profile, features: ROOM_FEATURES }));
              sendUI('connected', { name: room.name, profile: guestProfile, features: remoteFeatures });
            }
          };
          socket.send(JSON.stringify({ type: 'pending' }));
          sendUI('join-request', { id, address: ip.replace(/^::ffff:/, ''), profile: guestProfile, expiresAt: Date.now() + 60000 });
        } else if (peer === socket) {
          if (msg.type === 'profile' && validProfile(msg.profile)) {
            remoteProfile = { name: msg.profile.name.trim(), avatar: msg.profile.avatar };
            sendUI('peer-profile', remoteProfile);
          } else if (validSignal(msg)) sendUI('signal', msg);
          else receiveRoomMessage(msg);
        }
      } catch { socket.close(1008, 'Mensagem inválida.'); }
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      clearPendingJoin(socket);
      if (peer === socket) { files.reset(); setFloating(false); peer = undefined; remoteProfile = undefined; remoteFeatures = []; sendUI('disconnected', { hosting: true }); }
    });
    socket.on('pong', () => { socket.alive = true; });
  });
  hostServer.on('error', () => sendUI('network-error', 'Não foi possível manter a sala aberta.'));
  announcement = setInterval(announce, 2000);
  heartbeat = setInterval(() => {
    if (!peer) return;
    if (!peer.alive) return peer.terminate();
    peer.alive = false;
    peer.ping();
  }, 10000);
  announce();
  return room;
}
function join({ address }) {
  if (!profile) throw new Error('Salve seu nome e avatar antes de pedir para entrar.');
  if (typeof address === 'string' && /^share-local:/i.test(address)) address = parseInvitation(address).address;
  if (!validAddress(address)) throw connectionError('Informe um convite válido ou o IP da rede local exibido no outro computador.', 'INVALID_ADDRESS');
  reset();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${address}:${PORT}`, { handshakeTimeout: 8000, maxPayload: 128 * 1024, perMessageDeflate: false });
    client = socket;
    let joined = false, waiting = false, heartbeatTimeout;
    const watchHeartbeat = () => { clearTimeout(heartbeatTimeout); if (joined) heartbeatTimeout = setTimeout(() => socket.terminate(), 25000); };
    let timeout = setTimeout(() => { reject(connectionError('A sala não respondeu. Confira se ela está aberta no outro computador.', 'UNAVAILABLE')); socket.terminate(); }, 10000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join-request', profile, features: ROOM_FEATURES })));
    socket.on('ping', watchHeartbeat);
    socket.on('message', (bytes, binary) => {
      if (binary) {
        if (joined && client === socket) files.receiveChunk(bytes, socket);
        else socket.close(1008, 'Entrada não autorizada.');
        return;
      }
      try {
        const msg = JSON.parse(bytes);
        if (msg.type === 'pending' && !joined && !waiting) {
          waiting = true;
          clearTimeout(timeout);
          timeout = setTimeout(() => { reject(connectionError('O pedido expirou sem resposta. Peça para entrar novamente.', 'EXPIRED')); socket.terminate(); }, 65000);
          sendUI('join-pending', { expiresAt: Date.now() + 60000 });
        }
        else if (msg.type === 'joined' && !joined) {
          if (msg.profile !== undefined && !validProfile(msg.profile)) throw new Error('Perfil inválido.');
          joined = true;
          clearTimeout(timeout);
          watchHeartbeat();
          remoteProfile = msg.profile ? { name: msg.profile.name.trim(), avatar: msg.profile.avatar } : fallbackProfile;
          remoteFeatures = readFeatures(msg.features);
          resolve({ name: String(msg.name).slice(0, 40), profile: remoteProfile, address, features: remoteFeatures });
        }
        else if (msg.type === 'rejected' && !joined) { clearTimeout(timeout); reject(connectionError(typeof msg.message === 'string' ? msg.message.slice(0, 240) : 'Seu pedido não foi aceito.', msg.code || 'DECLINED')); socket.close(); }
        else if (joined && client === socket && msg.type === 'profile' && validProfile(msg.profile)) {
          remoteProfile = { name: msg.profile.name.trim(), avatar: msg.profile.avatar };
          sendUI('peer-profile', remoteProfile);
        }
        else if (joined && client === socket && validSignal(msg)) sendUI('signal', msg);
        else if (joined && client === socket) receiveRoomMessage(msg);
      } catch { socket.close(); }
    });
    socket.on('error', () => { clearTimeout(timeout); reject(connectionError('Não foi possível alcançar a sala.', 'NETWORK')); });
    socket.on('close', () => {
      clearTimeout(timeout);
      clearTimeout(heartbeatTimeout);
      if (!joined) reject(connectionError('O pedido de entrada foi encerrado. Confira se a sala continua aberta.', 'UNAVAILABLE'));
      if (client === socket) { files.reset(); setFloating(false); client = undefined; remoteProfile = undefined; remoteFeatures = []; if (joined) sendUI('disconnected', { hosting: false }); }
    });
  });
}
const smokeData = smokeTest && launchOptions.find(arg => arg.startsWith('--smoke-user-data='));
if (smokeData) app.setPath('userData', path.resolve(smokeData.slice('--smoke-user-data='.length)));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  const initialInvite = invitationArgument(process.argv);
  if (initialInvite) receiveInvitation(initialInvite);
  app.on('second-instance', (_event, args) => {
    if (win?.isMinimized()) win.restore();
    if (!smokeTest) win?.show();
    win?.focus();
    const invitation = invitationArgument(args);
    if (invitation) receiveInvitation(invitation);
  });
  app.whenReady().then(() => {
    profileFile = path.join(app.getPath('userData'), 'profile.json');
    win = new BrowserWindow({ show: !smokeTest, width: 1180, height: 790, minWidth: 760, minHeight: 600, backgroundColor: '#16151c', autoHideMenuBar: true,
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
        offscreen: smokeTest, backgroundThrottling: !smokeTest } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('did-start-loading', () => { readyForInvites = false; reset(); });
    win.webContents.on('render-process-gone', () => { readyForInvites = false; reset(); });
    win.webContents.on('will-navigate', event => event.preventDefault());
    files = createFileTransfers({
      isConnected: () => activeSocket()?.readyState === WebSocket.OPEN,
      send: sendRoomMessage, emit: data => sendUI('file-state', data),
      chooseFile: async () => {
        const result = await dialog.showOpenDialog(win, { title: 'Escolher arquivo para enviar', properties: ['openFile'] });
        return result.canceled ? undefined : result.filePaths[0];
      },
      chooseDestination: async name => {
        const result = await dialog.showSaveDialog(win, { title: 'Salvar arquivo recebido', defaultPath: path.join(app.getPath('downloads'), name) });
        return result.canceled ? undefined : result.filePath;
      }
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === win.webContents && contents.getURL() === pageURL && Boolean(selectedSource) &&
        (permission === 'display-capture' || permission === 'media'));
    });
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      let streams = {};
      try {
        if (request.frame === win.webContents.mainFrame && selectedSource) {
          const selection = selectedSource;
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
          if (selectedSource === selection) {
            const source = sources.find(s => s.id === selection.id);
            selectedSource = undefined;
            if (source) streams = { video: source, ...(selection.audio && request.audioRequested ? { audio: 'loopback' } : {}) };
          }
        }
      } catch {}
      // O pedido nativo pode ter sido cancelado enquanto as fontes eram carregadas.
      try { callback(streams); } catch {}
    });
    ipcMain.handle('action', async (event, action, data) => {
      if (event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageURL) throw new Error('Origem inválida.');
      try {
        if (action === 'initial-state') {
          profile = readProfile(profileFile);
          readyForInvites = true;
          const state = { profile, invitation: queuedInvite, inviteError };
          queuedInvite = inviteError = undefined;
          return { ok: true, value: state };
        }
        if (action === 'save-profile') {
          profile = saveProfile(profileFile, data);
          const socket = peer || client;
          if (remoteProfile && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'profile', profile }));
          return { ok: true, value: profile };
        }
        if (action === 'host') return { ok: true, value: await host(data) };
        if (action === 'floating' && typeof data === 'boolean') {
          if (data && !remoteProfile) throw new Error('Conecte-se à sala antes de abrir a janela flutuante.');
          return { ok: true, value: setFloating(data) };
        }
        if (action === 'chat-send') {
          if (!remoteFeatures.includes('chat')) throw new Error('A outra pessoa precisa atualizar o Share Local para usar o chat.');
          const message = { type: 'chat', id: randomUUID(), text: typeof data === 'string' ? data.trim() : data };
          if (!validChat(message)) throw new Error('Escreva uma mensagem de até 2.000 caracteres.');
          await sendRoomMessage(message);
          return { ok: true, value: { id: message.id, text: message.text, profile, at: Date.now() } };
        }
        if (action === 'open-link') {
          if (!safeExternalURL(data)) throw new Error('Este link não é um endereço HTTP ou HTTPS válido.');
          await shell.openExternal(new URL(data).href);
          return { ok: true };
        }
        if (action === 'file-offer') {
          if (!remoteFeatures.includes('files')) throw new Error('A outra pessoa precisa atualizar o Share Local para receber arquivos.');
          await files.offer();
          return { ok: true };
        }
        if (action === 'file-respond') { await files.respond(data || {}); return { ok: true }; }
        if (action === 'file-cancel') { await files.cancel(data); return { ok: true }; }
        if (action === 'update-state') return { ok: true, value: updates.state() };
        if (action === 'check-updates') return { ok: true, value: await updates.check() };
        if (action === 'join') return { ok: true, value: await join(data) };
        if (action === 'copy-invite') {
          if (!room) throw new Error('Abra uma sala antes de copiar o convite.');
          const address = data === undefined ? room.addresses[0] : data;
          if (!address) throw new Error('Conecte este computador à rede local antes de copiar o convite.');
          if (!room.addresses.includes(address)) throw new Error('Escolha um dos IPs exibidos neste computador para criar o convite.');
          const invitation = makeInvitation(address, room.name);
          clipboard.writeText(invitation);
          return { ok: true, value: invitation };
        }
        if (action === 'respond-join') {
          if (!pendingJoin || data?.id !== pendingJoin.id || typeof data.approve !== 'boolean') throw new Error('Este pedido de entrada não está mais disponível.');
          const request = pendingJoin;
          clearPendingJoin(request.socket);
          if (request.socket.readyState !== WebSocket.OPEN) throw new Error('A outra pessoa cancelou o pedido de entrada.');
          request.respond(data.approve);
          return { ok: true };
        }
        if (action === 'leave') { reset(); return { ok: true }; }
        if (action === 'sources') {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
          return { ok: true, value: sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })) };
        }
        if (action === 'select-source') {
          const selection = typeof data === 'string' ? { id: data, audio: true } : data;
          if (typeof selection?.id !== 'string' || selection.id.length > 256 || typeof selection.audio !== 'boolean') throw new Error('Escolha uma tela ou janela e a opção de áudio.');
          selectedSource = { id: selection.id, audio: selection.audio };
          return { ok: true };
        }
        if (action === 'signal' && validSignal(data)) {
          const socket = peer || client;
          if (socket?.readyState !== WebSocket.OPEN) throw new Error('A outra pessoa desconectou.');
          socket.send(JSON.stringify(data));
          return { ok: true };
        }
        throw new Error('Ação inválida.');
      } catch (error) {
        const message = error.code === 'EADDRINUSE' ? 'A porta da sala já está em uso. Feche outra instância e tente novamente.' :
          action === 'save-profile' && error.code ? 'Não foi possível salvar o perfil. Verifique a permissão de gravação do aplicativo e tente novamente.' : error.message;
        return { ok: false, code: error.code, error: message };
      }
    });
    updates = startUpdates({ app, updater: require('electron-updater').autoUpdater,
      configured: fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')),
      emit: data => sendUI('update-state', data), isBusy: () => Boolean(room || client || peer) });
    win.loadFile(path.join(__dirname, 'index.html'));
    startDiscovery();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    updates?.stop();
    const cleanup = reset();
    udp?.close();
    Promise.resolve(cleanup).finally(() => app.quit());
  });
}
