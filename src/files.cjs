const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { TRANSFER_CHUNK, validFileMessage, validFilename } = require('./room-protocol.cjs');

async function commitReceivedFile(partial, target) {
  try { await fs.link(partial, target); }
  catch (error) {
    if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
    await fs.copyFile(partial, target, require('node:fs').constants.COPYFILE_EXCL);
  }
  await fs.unlink(partial);
}

function createFileTransfers({ chooseFile, chooseDestination, isConnected, send, emit }) {
  let outgoing, incoming, generation = 0;
  const cleanups = new Set();
  const current = state => state && (outgoing === state || incoming === state);
  const report = (state, status, extra = {}) => {
    const same = state.status === status, now = Date.now();
    state.status = status;
    if (same && ['sending', 'receiving'].includes(status) && now - state.reportedAt < 100 && state.bytes !== state.size) return;
    state.reportedAt = now;
    emit({ id: state.id, direction: state.direction, name: state.name || 'Arquivo', size: state.size || 0,
      bytes: state.bytes || 0, status, ...extra });
  };
  function cleanup(state) {
    // shortcut: uma queda forçada pode deixar .part; persistir a recuperação se esse cenário precisar ser automatizado.
    if (!state || state.cleanup) return state?.cleanup;
    state.reader?.destroy();
    state.writer?.removeAllListeners('drain');
    state.writer?.destroy();
    state.flow?.resume();
    const task = (async () => {
      try { await state.handle?.close(); } catch {}
      if (state.partial && state.created) {
        try { await fs.unlink(state.partial); } catch (error) { if (error.code !== 'ENOENT') report(state, 'error', { message: 'Não foi possível remover o arquivo parcial. Ele está na pasta escolhida.' }); }
      }
    })();
    state.cleanup = task;
    cleanups.add(task);
    task.finally(() => cleanups.delete(task));
    return task;
  }
  async function finish(state, status, extra = {}, notify = false) {
    if (!current(state)) return;
    const epoch = generation;
    if (outgoing === state) outgoing = undefined;
    if (incoming === state) incoming = undefined;
    report(state, status, extra);
    await cleanup(state);
    if (notify && epoch === generation && isConnected()) await send({ type: 'file-cancel', id: state.id }).catch(() => {});
  }
  const fail = (state, message) => finish(state, 'error', { message }, true);
  async function offer() {
    if (!isConnected()) throw new Error('Entre em uma sala antes de enviar um arquivo.');
    if (outgoing) throw new Error('Conclua ou cancele o envio atual antes de escolher outro arquivo.');
    const epoch = generation;
    const state = { id: randomUUID(), direction: 'outgoing', bytes: 0 };
    outgoing = state;
    report(state, 'choosing');
    try {
      const source = await chooseFile();
      if (!current(state) || epoch !== generation) return;
      if (!source) return finish(state, 'cancelled');
      const handle = await fs.open(source, 'r');
      if (!current(state)) { await handle.close(); return; }
      state.handle = handle;
      const info = await handle.stat();
      if (!current(state)) return;
      state.name = path.basename(source);
      state.size = info.size;
      state.modified = info.mtimeMs;
      state.changed = info.ctimeMs;
      if (!info.isFile() || !validFilename(state.name) || !Number.isSafeInteger(info.size)) throw new Error('Escolha um arquivo comum com um nome válido.');
      report(state, 'offered');
      await send({ type: 'file-offer', id: state.id, name: state.name, size: state.size });
    } catch { await fail(state, 'Não foi possível preparar o arquivo para envio. Confira se ele ainda existe e pode ser lido.'); }
  }
  async function respond({ id, accept }) {
    const state = incoming;
    if (!state || id !== state.id || state.status !== 'offered' || typeof accept !== 'boolean') throw new Error('Este pedido de arquivo não está mais disponível.');
    if (!accept) {
      await send({ type: 'file-reject', id });
      return finish(state, 'declined');
    }
    report(state, 'choosing');
    try {
      const target = await chooseDestination(state.name);
      if (!current(state)) return;
      if (!target) { report(state, 'offered'); return; }
      try {
        await fs.lstat(target);
        report(state, 'offered', { message: 'Já existe um arquivo com esse nome. Escolha outro nome para preservar o original.' });
        return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!current(state)) return;
      state.partial = path.join(path.dirname(target), `.share-local-${state.id}.part`);
      const handle = await fs.open(state.partial, 'wx', 0o600);
      if (!current(state)) { await handle.close(); await fs.unlink(state.partial); return; }
      state.handle = handle;
      state.created = true;
      state.target = target;
      state.hash = createHash('sha256');
      state.writer = handle.createWriteStream({ autoClose: true, flush: true, highWaterMark: TRANSFER_CHUNK });
      state.writer.on('error', () => { fail(state, 'Não foi possível gravar o arquivo. Confira o espaço livre e as permissões da pasta.'); });
      report(state, 'receiving');
      await send({ type: 'file-accept', id });
    } catch { await fail(state, 'Não foi possível salvar nesta pasta. Escolha outro local e peça o arquivo novamente.'); }
  }
  async function sendFile(state) {
    if (!current(state) || state.status !== 'offered') return;
    report(state, 'sending');
    const hash = createHash('sha256');
    try {
      const before = await state.handle.stat();
      if (!current(state)) return;
      if (before.size !== state.size || before.mtimeMs !== state.modified || before.ctimeMs !== state.changed) return fail(state, 'O arquivo foi alterado antes do envio. Escolha-o novamente.');
      if (state.size) {
        state.reader = state.handle.createReadStream({ autoClose: false, start: 0, end: state.size - 1, highWaterMark: TRANSFER_CHUNK });
        for await (const chunk of state.reader) {
          if (!current(state)) return;
          hash.update(chunk);
          await send(Buffer.concat([Buffer.from(state.id, 'ascii'), chunk]));
          if (!current(state)) return;
          state.bytes += chunk.length;
          report(state, 'sending');
        }
      }
      if (!current(state)) return;
      const after = await state.handle.stat();
      if (!current(state)) return;
      if (state.bytes !== state.size || after.size !== state.size || after.mtimeMs !== state.modified || after.ctimeMs !== state.changed) return fail(state, 'O arquivo foi alterado durante o envio. Escolha-o novamente.');
      state.reader?.destroy();
      report(state, 'confirming');
      await send({ type: 'file-end', id: state.id, sha256: hash.digest('hex') });
    } catch { await fail(state, 'O envio foi interrompido. Confira a conexão e tente novamente.'); }
  }
  function receiveChunk(bytes, flow) {
    const state = incoming;
    if (!state || state.status !== 'receiving' || bytes.length < 37 || bytes.length > TRANSFER_CHUNK + 36 || bytes.toString('ascii', 0, 36) !== state.id) return;
    const chunk = bytes.subarray(36);
    if (state.bytes + chunk.length > state.size) { fail(state, 'O arquivo recebido ultrapassou o tamanho informado.'); return; }
    state.bytes += chunk.length;
    state.hash.update(chunk);
    state.flow = flow;
    if (!state.writer.write(chunk)) {
      flow.pause();
      state.writer.once('drain', () => flow.resume());
    }
    report(state, 'receiving');
  }
  async function completeIncoming(state, sha256) {
    if (!current(state) || state.status !== 'receiving') return;
    report(state, 'saving');
    try {
      if (state.bytes !== state.size || state.hash.digest('hex') !== sha256) return fail(state, 'O arquivo chegou incompleto ou diferente do original. Peça um novo envio.');
      await new Promise((resolve, reject) => { state.writer.once('error', reject); state.writer.once('close', resolve); state.writer.end(); });
      if (!current(state)) return;
      state.handle = undefined;
      if (!current(state)) return;
      await commitReceivedFile(state.partial, state.target);
      state.created = false;
      if (!current(state)) return;
      await send({ type: 'file-complete', id: state.id });
      await finish(state, 'done', { path: state.target });
    } catch (error) { await fail(state, error.code === 'EEXIST' ? 'Um arquivo com esse nome já existe. O original foi preservado; escolha outro nome e tente novamente.' : 'Não foi possível concluir o arquivo. O destino original foi preservado.'); }
  }
  async function receive(message) {
    if (!validFileMessage(message)) return;
    if (message.type === 'file-offer') {
      if (incoming || message.id === outgoing?.id) return send({ type: 'file-reject', id: message.id }).catch(() => {});
      incoming = { id: message.id, direction: 'incoming', name: message.name, size: message.size, bytes: 0 };
      report(incoming, 'offered');
    } else if (message.type === 'file-accept') await sendFile(outgoing?.id === message.id ? outgoing : undefined);
    else if (message.type === 'file-end' && incoming?.id === message.id) await completeIncoming(incoming, message.sha256);
    else if (message.type === 'file-complete' && outgoing?.id === message.id && outgoing.status === 'confirming') await finish(outgoing, 'done');
    else if (message.type === 'file-reject' && outgoing?.id === message.id) await finish(outgoing, 'declined');
    else if (message.type === 'file-cancel') await finish(incoming?.id === message.id ? incoming : outgoing?.id === message.id ? outgoing : undefined, 'cancelled', { message: 'A outra pessoa cancelou a transferência.' });
  }
  async function cancel(id) {
    const state = incoming?.id === id ? incoming : outgoing?.id === id ? outgoing : undefined;
    if (!state) return;
    await finish(state, 'cancelled', {}, true);
  }
  async function reset() {
    generation++;
    const states = [outgoing, incoming];
    outgoing = incoming = undefined;
    for (const state of states) if (state) { report(state, 'cancelled', { message: 'A conexão foi encerrada.' }); cleanup(state); }
    await Promise.allSettled([...cleanups]);
  }
  return { offer, respond, cancel, receive, receiveChunk, reset };
}

module.exports = { createFileTransfers, commitReceivedFile };
