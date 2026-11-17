let preferences = { volume: 100, shareAudio: true, quality: 'auto', notifications: true, minimizeToOverlay: true, overlayOpacity: 0.92, overlaySide: 'right' };
const QUALITY = {
  auto: { width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 },
  economy: { width: 1280, height: 720, fps: 20, bitrate: 1_200_000 },
  sharp: { width: 2560, height: 1440, fps: 30, bitrate: 8_000_000 }
};
function applyPreferences(value) {
  preferences = value;
  $('remote-volume').value = String(value.volume);
  $('share-audio').checked = value.shareAudio;
  $('quality').value = $('setting-quality').value = value.quality;
  $('setting-notifications').checked = value.notifications;
  $('setting-overlay').checked = value.minimizeToOverlay;
  $('setting-opacity').value = String(Math.round(value.overlayOpacity * 100));
  $('setting-side').value = value.overlaySide;
  $('opacity-value').textContent = `${Math.round(value.overlayOpacity * 100)}%`;
  updateRemoteAudio();
}
async function storePreference(patch) {
  preferences = await action('preferences', patch);
  return preferences;
}
async function applyCaptureQuality(track) {
  const quality = QUALITY[preferences.quality];
  await track.applyConstraints({ width: { max: quality.width }, height: { max: quality.height }, frameRate: { max: quality.fps, ideal: quality.fps } });
}
async function applySendingQuality(state) {
  if (!state?.videoSender || state !== outgoing) return;
  const parameters = state.videoSender.getParameters(), quality = QUALITY[preferences.quality];
  if (!parameters.encodings?.length) return;
  parameters.encodings[0].maxBitrate = quality.bitrate;
  parameters.encodings[0].maxFramerate = quality.fps;
  await state.videoSender.setParameters(parameters);
}
async function changeQuality(value) {
  const previous = preferences.quality, state = outgoing;
  try {
    await storePreference({ quality: value });
    if (state) { await applyCaptureQuality(state.stream.getVideoTracks()[0]); await applySendingQuality(state); }
    $('quality').value = $('setting-quality').value = value;
  } catch (error) {
    await storePreference({ quality: previous }).catch(() => {});
    if (state && outgoing === state) { await applyCaptureQuality(state.stream.getVideoTracks()[0]).catch(() => {}); await applySendingQuality(state).catch(() => {}); }
    $('quality').value = $('setting-quality').value = previous;
    notice(`Não foi possível alterar a qualidade. ${error.message}`);
  }
}
function toggleSharingPause() {
  const state = outgoing;
  if (!state || capturePending) return;
  state.paused = !state.paused;
  state.stream.getTracks().forEach(track => { track.enabled = !state.paused; });
  $('pause-share').textContent = state.paused ? 'Retomar' : 'Pausar';
  $('pause-share').setAttribute('aria-pressed', String(state.paused));
  $('change-source').disabled = state.paused;
  $('floating-sharing').textContent = state.paused ? 'Ⅱ Sua transmissão está pausada' : '● Você está compartilhando';
  if (peerFeatures.includes('pause-sharing')) action('signal', { type: 'pause', id: state.id, paused: state.paused }).catch(error => notice(error.message));
  updateRemoteAudio(); renderStage();
}
function handleShortcut(name) {
  if (!connected) return;
  if (name === 'mute' && !$('mute').disabled) { userMuted = !userMuted; updateRemoteAudio(); }
  if (name === 'pause') toggleSharingPause();
  if (name === 'stop') stopOutgoing();
  if (name === 'overlay') action('floating', !document.body.classList.contains('floating')).then(renderFloating).catch(error => notice(error.message));
}
bind('pause-share', toggleSharingPause);
bind('window-minimize', () => action('window', 'minimize'));
bind('window-maximize', () => action('window', 'maximize'));
bind('window-close', () => action('window', 'close'));
bind('overlay-taskbar', () => action('window', 'taskbar'));
bind('open-settings', () => $('settings-dialog').showModal());
bind('close-settings', () => $('settings-dialog').close());
bind('reconnect-room', () => { $('join-form').requestSubmit(); });
$('quality').addEventListener('change', event => changeQuality(event.target.value));
$('setting-quality').addEventListener('change', event => changeQuality(event.target.value));
$('remote-volume').addEventListener('change', () => storePreference({ volume: Number($('remote-volume').value) }).catch(error => notice(error.message)));
$('share-audio').addEventListener('change', () => storePreference({ shareAudio: $('share-audio').checked }).catch(error => notice(error.message)));
for (const [id, key, read] of [
  ['setting-notifications', 'notifications', input => input.checked], ['setting-overlay', 'minimizeToOverlay', input => input.checked],
  ['setting-opacity', 'overlayOpacity', input => Number(input.value) / 100], ['setting-side', 'overlaySide', input => input.value]
]) $(id).addEventListener('change', async event => {
  try { applyPreferences(await storePreference({ [key]: read(event.target) })); }
  catch (error) { applyPreferences(preferences); notice(error.message); }
});
function renderFileQueue(items) {
  $('file-queue-list').replaceChildren();
  for (const item of items) {
    const row = document.createElement('div'), name = document.createElement('span'), remove = document.createElement('button');
    name.textContent = item.name; remove.textContent = 'Remover'; remove.className = 'quiet';
    remove.addEventListener('click', () => action('file-queue-remove', item.id).catch(error => notice(error.message)));
    row.append(name, remove); $('file-queue-list').append(row);
  }
  $('file-queue-wrap').hidden = !items.length;
  $('file-queue-count').textContent = `${items.length} na fila`;
}
bind('clear-file-queue', () => action('file-queue-clear'));
document.addEventListener('dragover', event => {
  event.preventDefault();
  if (connected && secureReady && event.dataTransfer.types.includes('Files')) document.body.classList.add('file-dragging');
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('file-dragging'); });
document.addEventListener('drop', async event => {
  event.preventDefault(); document.body.classList.remove('file-dragging');
  if (!connected || !secureReady || !event.dataTransfer.files.length) return;
  try { await window.canto.dropFiles(Array.from(event.dataTransfer.files)); await openRoomTools('files'); }
  catch (error) { notice(error.message); }
});
