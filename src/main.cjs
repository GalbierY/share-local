const { app, BrowserWindow, ipcMain, desktopCapturer, session, clipboard } = require('electron');
const { WebSocketServer, WebSocket } = require('ws');
const { randomUUID } = require('node:crypto');
const dgram = require('node:dgram');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { validSignal, localAddresses, validAddress } = require('./protocol.cjs');
const { startUpdates } = require('./updates.cjs');
const PORT = 45878, DISCOVERY = 45879;
const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
let win, server, peer, client, udp, announcement, heartbeat, room, selectedSource, pendingJoin;
let closing = false;
let updates;
const sendUI = (type, data) => { if (win && !win.isDestroyed()) win.webContents.send('event', { type, data }); };
function clearPendingJoin(socket) {
  if (!pendingJoin || pendingJoin.socket !== socket) return;
  clearTimeout(pendingJoin.timeout);
  const { id } = pendingJoin;
  pendingJoin = undefined;
  sendUI('join-request-ended', { id });
}
function reset() {
  clearInterval(announcement);
  clearInterval(heartbeat);
  announcement = undefined;
  room = undefined;
  selectedSource = undefined;
  const oldPeer = peer, oldClient = client, oldServer = server;
  if (pendingJoin) clearPendingJoin(pendingJoin.socket);
  peer = client = server = undefined;
  oldPeer?.terminate();
  oldClient?.terminate();
  oldServer?.clients.forEach(socket => socket.terminate());
  oldServer?.close();
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
  reset();
  const hostServer = new WebSocketServer({ port: PORT, host: '0.0.0.0', maxPayload: 128 * 1024, perMessageDeflate: false });
  server = hostServer;
  await new Promise((resolve, reject) => { hostServer.once('listening', resolve); hostServer.once('error', reject); });
  room = { name: String(name || '').trim().slice(0, 40) || 'Nosso cantinho', addresses: localAddresses() };
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
      socket.send(JSON.stringify({ type: 'rejected', message: peer ? 'A sala já está completa.' : pendingJoin ? 'Há outro pedido de entrada em andamento. Tente novamente em instantes.' : 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.' }));
      return socket.close(1008);
    }
    let authenticated = false;
    const timeout = setTimeout(() => socket.close(1008, 'Tempo de entrada esgotado.'), 5000);
    socket.on('message', bytes => {
      try {
        const msg = JSON.parse(bytes);
        if (!authenticated) {
          if (msg.type !== 'join-request' || peer || pendingJoin) {
            socket.send(JSON.stringify({ type: 'rejected', message: msg.type === 'join' ? 'Esta sala usa autorização de entrada. Atualize o Share Local nos dois computadores.' : 'Pedido de entrada inválido ou sala ocupada.' }));
            return socket.close(1008);
          }
          clearTimeout(timeout);
          const id = randomUUID();
          const reject = message => { socket.send(JSON.stringify({ type: 'rejected', message })); socket.close(1008); };
          pendingJoin = { id, socket,
            timeout: setTimeout(() => { clearPendingJoin(socket); reject('O pedido expirou sem resposta. Peça para entrar novamente.'); }, 60000),
            respond: approve => {
              if (!approve) return reject('Seu pedido de entrada foi recusado.');
              authenticated = true;
              peer = socket;
              socket.alive = true;
              socket.send(JSON.stringify({ type: 'joined', name: room.name }));
              sendUI('connected', { name: room.name });
            }
          };
          socket.send(JSON.stringify({ type: 'pending' }));
          sendUI('join-request', { id, address: ip.replace(/^::ffff:/, '') });
        } else if (validSignal(msg)) sendUI('signal', msg);
      } catch { socket.close(1008, 'Mensagem inválida.'); }
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      clearPendingJoin(socket);
      if (peer === socket) { peer = undefined; sendUI('disconnected', { hosting: true }); }
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
  if (!validAddress(address)) throw new Error('Informe o IP da rede local exibido no outro computador.');
  reset();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${address}:${PORT}`, { handshakeTimeout: 8000, maxPayload: 128 * 1024, perMessageDeflate: false });
    client = socket;
    let joined = false, waiting = false;
    let timeout = setTimeout(() => { reject(new Error('A sala não respondeu. Confira o IP e o firewall.')); socket.terminate(); }, 10000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join-request' })));
    socket.on('message', bytes => {
      try {
        const msg = JSON.parse(bytes);
        if (msg.type === 'pending' && !joined && !waiting) {
          waiting = true;
          clearTimeout(timeout);
          timeout = setTimeout(() => { reject(new Error('O pedido expirou sem resposta. Peça para entrar novamente.')); socket.terminate(); }, 65000);
          sendUI('join-pending');
        }
        else if (msg.type === 'joined' && !joined) { joined = true; clearTimeout(timeout); resolve({ name: String(msg.name).slice(0, 40) }); }
        else if (msg.type === 'rejected' && !joined) { clearTimeout(timeout); reject(new Error(msg.message)); socket.close(); }
        else if (joined && validSignal(msg)) sendUI('signal', msg);
      } catch { socket.close(); }
    });
    socket.on('error', () => { clearTimeout(timeout); reject(new Error('Não conectou. Confira se a sala está aberta e se o firewall permite redes privadas.')); });
    socket.on('close', () => {
      clearTimeout(timeout);
      if (!joined) reject(new Error('O pedido de entrada foi encerrado. Confira se a sala continua aberta.'));
      if (client === socket) { client = undefined; if (joined) sendUI('disconnected', { hosting: false }); }
    });
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(() => {
    win = new BrowserWindow({ show: !process.argv.includes('--smoke-test'), width: 1180, height: 790, minWidth: 760, minHeight: 600, backgroundColor: '#16151c', autoHideMenuBar: true,
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
        offscreen: process.argv.includes('--smoke-test'), backgroundThrottling: !process.argv.includes('--smoke-test') } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === win.webContents && contents.getURL() === pageURL && Boolean(selectedSource) &&
        (permission === 'display-capture' || permission === 'media'));
    });
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        if (request.frame !== win.webContents.mainFrame || !selectedSource) return callback({});
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        const source = sources.find(s => s.id === selectedSource);
        selectedSource = undefined;
        callback(source ? { video: source, audio: 'loopback' } : {});
      } catch { callback({}); }
    });
    ipcMain.handle('action', async (event, action, data) => {
      if (event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageURL) throw new Error('Origem inválida.');
      try {
        if (action === 'host') return { ok: true, value: await host(data) };
        if (action === 'update-state') return { ok: true, value: updates.state() };
        if (action === 'check-updates') return { ok: true, value: await updates.check() };
        if (action === 'join') return { ok: true, value: await join(data) };
        if (action === 'copy-invite') {
          if (!room) throw new Error('Abra uma sala antes de copiar o convite.');
          clipboard.writeText(`Vamos compartilhar uma tela no Share Local?\nSala: ${room.name}\nIP: ${room.addresses.join(' · ') || 'indisponível'}\nConecte à mesma rede Wi-Fi ou cabo, escolha a sala ou informe o IP e clique em Pedir para entrar. Vou autorizar por aqui.`);
          return { ok: true };
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
        if (action === 'select-source' && typeof data === 'string') { selectedSource = data; return { ok: true }; }
        if (action === 'signal' && validSignal(data)) {
          const socket = peer || client;
          if (socket?.readyState !== WebSocket.OPEN) throw new Error('A outra pessoa desconectou.');
          socket.send(JSON.stringify(data));
          return { ok: true };
        }
        throw new Error('Ação inválida.');
      } catch (error) { return { ok: false, error: error.code === 'EADDRINUSE' ? 'A porta da sala já está em uso. Feche outra instância e tente novamente.' : error.message }; }
    });
    updates = startUpdates({ app, updater: require('electron-updater').autoUpdater,
      configured: fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')),
      emit: data => sendUI('update-state', data), isBusy: () => Boolean(room || client || peer) });
    win.loadFile(path.join(__dirname, 'index.html'));
    startDiscovery();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (!closing) { closing = true; updates?.stop(); reset(); udp?.close(); } });
}
