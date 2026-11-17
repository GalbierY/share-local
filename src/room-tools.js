let activeTool = 'chat', unreadMessages = 0, chatSending = false;
const chatIds = new Set(), fileModels = new Map(), fileCards = new Map();
const terminalFiles = new Set(['done', 'declined', 'cancelled', 'error']);

function renderFloating(value) {
  document.body.classList.toggle('floating', value);
  $('floating').textContent = value ? 'Voltar à sala' : 'Janela flutuante';
  $('floating').setAttribute('aria-pressed', String(value));
}
function updateRoomTools() {
  $('room-actions').hidden = !connected;
  $('show-chat').disabled = !connected || !peerFeatures.includes('chat');
  $('show-files').disabled = !connected || !peerFeatures.includes('files');
  $('tools-compat').hidden = !connected || (peerFeatures.includes('chat') && peerFeatures.includes('files'));
  $('chat-input').disabled = chatSending || $('show-chat').disabled;
  $('send-chat').disabled = $('chat-input').disabled || !$('chat-input').value.trim();
  const sending = [...fileModels.values()].some(file => file.direction === 'outgoing' && !terminalFiles.has(file.status));
  $('send-file').disabled = $('show-files').disabled || sending;
  $('chat-badge').hidden = unreadMessages === 0;
  $('chat-badge').textContent = String(unreadMessages);
  const pending = [...fileModels.values()].filter(file => file.direction === 'incoming' && file.status === 'offered').length;
  $('files-badge').hidden = pending === 0;
  $('files-badge').textContent = String(pending);
}
function markChatRead() {
  unreadMessages = 0;
  updateRoomTools();
}
async function openRoomTools(tool, focus = true) {
  if (!connected || !peerFeatures.includes(tool === 'chat' ? 'chat' : 'files')) return;
  if (document.body.classList.contains('floating')) renderFloating(await action('floating', false));
  activeTool = tool;
  $('room-tools').hidden = false;
  $('chat-panel').hidden = tool !== 'chat';
  $('files-panel').hidden = tool !== 'files';
  $('tools-chat').setAttribute('aria-pressed', String(tool === 'chat'));
  $('tools-files').setAttribute('aria-pressed', String(tool === 'files'));
  $('show-chat').setAttribute('aria-expanded', String(tool === 'chat'));
  $('show-files').setAttribute('aria-expanded', String(tool === 'files'));
  if (tool === 'chat') {
    markChatRead();
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
    if (focus) $('chat-input').focus();
  } else if (focus) $('send-file').focus();
  if (innerWidth <= 1100) $('room-tools').scrollIntoView({ block: 'nearest' });
}
function closeRoomTools() {
  $('room-tools').hidden = true;
  $('show-chat').setAttribute('aria-expanded', 'false');
  $('show-files').setAttribute('aria-expanded', 'false');
}
function resetRoomTools() {
  chatIds.clear(); fileModels.clear(); fileCards.clear();
  $('chat-messages').replaceChildren(); $('file-list').replaceChildren();
  $('chat-empty').hidden = $('files-empty').hidden = false;
  $('chat-input').value = '';
  $('file-status').textContent = '';
  unreadMessages = 0;
  closeRoomTools();
  updateRoomTools();
}
function appendChat(message, mine = false) {
  if (!connected || chatIds.has(message.id)) return;
  const log = $('chat-messages');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  chatIds.add(message.id);
  const item = document.createElement('article');
  item.className = mine ? 'chat-message mine' : 'chat-message';
  item.dataset.id = message.id;
  const heading = document.createElement('div'); heading.className = 'chat-meta';
  const author = document.createElement('strong'); author.textContent = mine ? `${message.profile.name} · você` : message.profile.name;
  const time = document.createElement('time');
  time.dateTime = new Date(message.at).toISOString();
  time.textContent = new Date(message.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  heading.append(author, time);
  const text = document.createElement('p'); text.className = 'chat-text';
  let start = 0;
  for (const match of message.text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = match[0].replace(/[.,!?;:)]+$/, '');
    text.append(document.createTextNode(message.text.slice(start, match.index)));
    const link = document.createElement('a'); link.textContent = url; link.href = url; link.rel = 'noopener noreferrer';
    link.addEventListener('click', event => { event.preventDefault(); action('open-link', url).catch(error => notice(error.message)); });
    text.append(link);
    start = match.index + url.length;
  }
  text.append(document.createTextNode(message.text.slice(start)));
  item.append(heading, text); log.append(item);
  if (log.children.length > 100) { chatIds.delete(log.firstElementChild.dataset.id); log.firstElementChild.remove(); }
  $('chat-empty').hidden = true;
  if (mine || (activeTool === 'chat' && !$('room-tools').hidden && atBottom)) {
    log.scrollTop = log.scrollHeight;
    markChatRead();
  } else { unreadMessages = Math.min(99, unreadMessages + 1); updateRoomTools(); }
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit]}`;
}
function transferButton(label, handler) {
  const button = document.createElement('button'); button.className = 'quiet'; button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await handler(); } catch (error) { notice(error.message); }
    finally { button.disabled = false; }
  });
  return button;
}
function renderFileState(file) {
  if (!connected) return;
  const previous = fileModels.get(file.id);
  if (!previous && !['choosing', 'offered'].includes(file.status)) return;
  fileModels.set(file.id, file);
  let card = fileCards.get(file.id);
  if (!card) {
    const element = document.createElement('article'); element.className = 'transfer-card'; element.setAttribute('role', 'listitem'); element.dataset.id = file.id;
    const title = document.createElement('strong'); title.className = 'transfer-name';
    const size = document.createElement('span'); size.className = 'transfer-size';
    const status = document.createElement('span'); status.className = 'transfer-status';
    const progress = document.createElement('progress'); progress.max = 100; progress.setAttribute('aria-label', 'Progresso da transferência');
    const message = document.createElement('p'); message.className = 'transfer-message';
    const actions = document.createElement('div'); actions.className = 'transfer-actions';
    element.append(title, size, status, progress, message, actions); $('file-list').append(element);
    card = { element, title, size, status, progress, message, actions }; fileCards.set(file.id, card);
  }
  const labels = { choosing: 'Escolhendo arquivo ou pasta…', offered: file.direction === 'incoming' ? 'Aguardando sua autorização' : 'Aguardando a outra pessoa aceitar', sending: 'Enviando…', receiving: 'Recebendo…', confirming: 'Confirmando recebimento…', saving: 'Salvando arquivo…', done: file.direction === 'incoming' ? 'Recebido e conferido' : 'Recebimento confirmado', declined: 'Arquivo recusado', cancelled: 'Transferência cancelada', error: 'Transferência interrompida' };
  card.title.textContent = file.name; card.title.title = file.name;
  card.size.textContent = `${file.direction === 'incoming' ? 'Receber' : 'Enviar'} · ${formatBytes(file.bytes)} de ${formatBytes(file.size)}`;
  card.status.textContent = labels[file.status] || 'Aguardando…';
  card.progress.value = file.status === 'done' ? 100 : file.size ? Math.min(100, 100 * file.bytes / file.size) : 0;
  card.progress.hidden = ['choosing', 'offered', 'declined', 'cancelled', 'error'].includes(file.status);
  card.message.textContent = file.path ? `Salvo em: ${file.path}` : file.message || '';
  card.message.hidden = !card.message.textContent;
  if (previous?.status !== file.status) {
    card.actions.replaceChildren();
    if (file.direction === 'incoming' && file.status === 'offered') {
      card.actions.append(transferButton('Aceitar e salvar', () => action('file-respond', { id: file.id, accept: true })), transferButton('Recusar', () => action('file-respond', { id: file.id, accept: false })));
    } else if (!terminalFiles.has(file.status) && file.status !== 'saving') card.actions.append(transferButton('Cancelar', () => action('file-cancel', file.id)));
    if (file.status === 'offered' && file.direction === 'incoming') {
      $('file-status').textContent = `${otherProfile?.name || 'Sua companhia'} quer enviar ${file.name}.`;
      notice(`Pedido de arquivo: ${file.name}. Abra Arquivos para aceitar ou recusar.`);
    } else if (terminalFiles.has(file.status)) $('file-status').textContent = `${file.name}: ${labels[file.status]}.`;
  }
  for (const [id, old] of fileModels) {
    if (fileModels.size <= 20) break;
    if (terminalFiles.has(old.status)) { fileCards.get(id)?.element.remove(); fileCards.delete(id); fileModels.delete(id); }
  }
  $('files-empty').hidden = fileModels.size > 0;
  updateRoomTools();
}

bind('show-chat', () => openRoomTools('chat'));
bind('show-files', () => openRoomTools('files'));
bind('tools-chat', () => openRoomTools('chat'));
bind('tools-files', () => openRoomTools('files'));
bind('close-tools', () => { closeRoomTools(); $(activeTool === 'chat' ? 'show-chat' : 'show-files').focus(); });
bind('send-file', () => action('file-offer'));
bind('floating', async () => {
  if (!document.body.classList.contains('floating') && $('remote').paused) playRemote().catch(() => {});
  renderFloating(await action('floating', !document.body.classList.contains('floating')));
});
$('chat-input').addEventListener('input', updateRoomTools);
$('chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit(); } });
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (chatSending || !$('chat-input').value.trim()) return;
  const epoch = connectionGeneration;
  chatSending = true; updateRoomTools();
  try {
    const message = await action('chat-send', $('chat-input').value);
    if (epoch === connectionGeneration) { appendChat(message, true); $('chat-input').value = ''; }
  } catch (error) { notice(error.message); }
  finally { chatSending = false; updateRoomTools(); if (epoch === connectionGeneration && !$('room-tools').hidden) $('chat-input').focus(); }
});
window.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('floating')) action('floating', false).then(renderFloating).catch(error => notice(error.message)); });
updateRoomTools();
