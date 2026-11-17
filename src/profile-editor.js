let profilePhoto, photoGeneration = 0, photoLoading = false;
const selectedAvatar = () => document.querySelector('input[name="avatar"]:checked').value;
function profileError(message) {
  $('profile-error').textContent = message;
  $('profile-error').hidden = !message;
}
function drawProfilePhoto() {
  if (!profilePhoto) return;
  const canvas = $('profile-photo'), context = canvas.getContext('2d');
  const size = Math.min(profilePhoto.width, profilePhoto.height) / Number($('photo-zoom').value);
  const x = (profilePhoto.width - size) * Number($('photo-x').value) / 100;
  const y = (profilePhoto.height - size) * Number($('photo-y').value) / 100;
  context.clearRect(0, 0, 128, 128);
  context.drawImage(profilePhoto, x, y, size, size, 0, 0, 128, 128);
}
function previewProfile() {
  const avatar = selectedAvatar();
  $('profile-preview-name').textContent = $('profile-name').value.trim() || 'Seu nome';
  $('profile-preview').src = avatar === 'custom' && profilePhoto ? $('profile-photo').toDataURL('image/png') : avatarSource({ avatar: avatar === 'custom' ? 'zahir' : avatar });
  $('photo-editor').hidden = avatar !== 'custom' || !profilePhoto;
  $('custom-avatar-option').hidden = !profilePhoto;
  $('profile-photo-option').src = profilePhoto ? $('profile-photo').toDataURL('image/png') : 'assets/zahir.svg';
  $('remove-photo').hidden = !profilePhoto;
}
function resetPhotoPosition() {
  $('photo-zoom').value = '1';
  $('photo-x').value = $('photo-y').value = '50';
  drawProfilePhoto();
}
async function loadProfilePhoto(file) {
  const generation = ++photoGeneration;
  photoLoading = true;
  profileError('');
  try {
    if (!file || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Escolha uma imagem PNG, JPG, WebP ou GIF.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Escolha uma imagem de até 10 MB.');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (generation !== photoGeneration || !$('profile-dialog').open) { bitmap.close(); return; }
    if (bitmap.width > 8192 || bitmap.height > 8192) { bitmap.close(); throw new Error('Escolha uma imagem de até 8192 pixels de largura e altura.'); }
    profilePhoto?.close();
    profilePhoto = bitmap;
    $('avatar-custom').checked = true;
    resetPhotoPosition();
    profileError('');
    previewProfile();
  } catch (error) {
    if (generation === photoGeneration && $('profile-dialog').open) profileError(error.message.startsWith('Escolha') ? error.message : 'Não foi possível abrir essa imagem. Escolha outro arquivo.');
  } finally {
    if (generation === photoGeneration) photoLoading = false;
  }
}
function showProfile() {
  if ($('profile-dialog').open) return $('profile-name').focus();
  $('profile-name').value = localProfile?.name || '';
  for (const radio of document.querySelectorAll('input[name="avatar"]')) radio.checked = radio.value === (localProfile?.avatar || 'zahir');
  $('cancel-profile').hidden = !localProfile;
  profileError('');
  previewProfile();
  $('profile-dialog').showModal();
  $('profile-name').focus();
  if (localProfile?.avatar === 'custom') {
    const bytes = Uint8Array.from(atob(localProfile.image.slice(22)), char => char.charCodeAt(0));
    loadProfilePhoto(new File([bytes], 'perfil.png', { type: 'image/png' }));
  }
}
bind('edit-profile', showProfile);
bind('cancel-profile', () => $('profile-dialog').close());
bind('reset-photo', () => { resetPhotoPosition(); previewProfile(); });
bind('remove-photo', () => {
  ++photoGeneration;
  photoLoading = false;
  profilePhoto?.close(); profilePhoto = undefined;
  if (selectedAvatar() === 'custom') document.querySelector('input[name="avatar"][value="zahir"]').checked = true;
  previewProfile();
});
$('profile-upload').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) loadProfilePhoto(file);
});
$('profile-name').addEventListener('input', previewProfile);
for (const radio of document.querySelectorAll('input[name="avatar"]')) radio.addEventListener('change', () => { ++photoGeneration; photoLoading = false; profileError(''); previewProfile(); });
for (const id of ['photo-zoom', 'photo-x', 'photo-y']) $(id).addEventListener('input', () => { drawProfilePhoto(); previewProfile(); });
$('profile-dialog').addEventListener('cancel', event => { if (!localProfile || $('save-profile').disabled) event.preventDefault(); });
$('profile-dialog').addEventListener('close', () => {
  ++photoGeneration;
  photoLoading = false;
  profilePhoto?.close(); profilePhoto = undefined;
});
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('save-profile').disabled) return;
  if (photoLoading) return profileError('Aguarde a imagem terminar de carregar antes de salvar.');
  const avatar = selectedAvatar();
  if (avatar === 'custom' && !profilePhoto) return profileError('Aguarde a foto carregar ou escolha um avatar.');
  $('save-profile').disabled = $('cancel-profile').disabled = true;
  profileError('');
  try {
    localProfile = await action('save-profile', { name: $('profile-name').value.trim(), avatar, ...(avatar === 'custom' ? { image: $('profile-photo').toDataURL('image/png') } : {}) });
    renderProfiles();
    $('host').disabled = $('join').disabled = false;
    $('profile-dialog').close();
    if (!$('invitation-banner').hidden) $('join').focus();
    notice('Seu perfil foi salvo neste computador.');
  } catch (error) { profileError(error.message); }
  finally { $('save-profile').disabled = $('cancel-profile').disabled = false; }
});
action('initial-state').then(state => {
  applyPreferences(state.preferences);
  localProfile = state.profile;
  renderProfiles();
  $('host').disabled = $('join').disabled = !localProfile;
  if (state.invitation) applyInvitation(state.invitation);
  if (state.inviteError) notice(state.inviteError);
  if (!localProfile) showProfile();
}).catch(error => { notice(`Não foi possível carregar seu perfil: ${error.message}`); showProfile(); });
