function startUpdates({ app, updater, configured, emit, isBusy, timers = globalThis }) {
  let state = { status: 'disabled', version: app.getVersion() };
  let checking = false, ready = false, installing = false;
  const handles = [];
  const update = (status, extra = {}) => { state = { status, version: app.getVersion(), ...extra }; emit(state); };
  async function check() {
    if (!app.isPackaged || !configured || checking || ready || installing) return state;
    checking = true;
    try { await updater.checkForUpdates(); }
    catch { update('error'); }
    finally { checking = false; }
    return state;
  }
  function installWhenIdle() {
    if (!ready || installing) return;
    if (isBusy()) return update('waiting', { nextVersion: state.nextVersion });
    installing = true;
    update('installing', { nextVersion: state.nextVersion });
    // O modo não silencioso do NSIS permite avisar se o Windows bloquear a instalação.
    updater.quitAndInstall(false, true);
  }
  if (!app.isPackaged) update('development');
  else if (!configured) update('unconfigured');
  else {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () => update('checking'));
    updater.on('update-not-available', () => update('current'));
    updater.on('update-available', info => update('downloading', { nextVersion: info.version, percent: 0 }));
    updater.on('download-progress', info => update('downloading', { nextVersion: state.nextVersion, percent: Math.floor(info.percent) }));
    updater.on('update-downloaded', info => {
      ready = true;
      update('waiting', { nextVersion: info.version });
      handles.push(timers.setTimeout(installWhenIdle, 30000));
    });
    updater.on('error', () => { installing = false; update('error'); });
    update('idle');
    handles.push(timers.setTimeout(check, 5000));
    handles.push(timers.setInterval(check, 4 * 60 * 60 * 1000));
    handles.push(timers.setInterval(installWhenIdle, 30000));
  }
  return {
    state: () => state,
    check,
    stop: () => handles.forEach(handle => { timers.clearTimeout(handle); timers.clearInterval(handle); })
  };
}
module.exports = { startUpdates };
