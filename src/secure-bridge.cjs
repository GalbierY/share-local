const { randomUUID } = require('node:crypto');
function createSecureBridge(emit) {
  let sessionId, ready = false;
  const pending = new Map();
  function unavailable() {
    ready = false;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('O canal protegido foi interrompido.')); }
    pending.clear();
  }
  return {
    start(id) { unavailable(); sessionId = id; },
    reset() { unavailable(); sessionId = undefined; },
    matches: id => Boolean(sessionId && id === sessionId),
    isReady: () => ready,
    setReady(id, value) { if (id !== sessionId || !sessionId) return false; if (!value) unavailable(); else ready = true; return true; },
    send(packet) {
      if (!ready) return Promise.reject(new Error('Aguarde a conexão protegida. Atualize os dois computadores para conversar e enviar arquivos.'));
      const payload = Buffer.isBuffer(packet) ? new Uint8Array(packet) : JSON.stringify(packet);
      if ((typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength) > 128 * 1024 || pending.size >= 32) return Promise.reject(new Error('A conexão está ocupada. Aguarde um instante.'));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('O canal protegido não respondeu.')); }, 15000);
        pending.set(id, { resolve, reject, timer });
        emit({ sessionId, id, packet: payload });
      });
    },
    acknowledge(id, requestId, error) {
      if (id !== sessionId) return;
      const request = pending.get(requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(requestId);
      if (error) request.reject(new Error('Não foi possível enviar pelo canal protegido.')); else request.resolve();
    }
  };
}
module.exports = { createSecureBridge };
