const { randomUUID } = require('node:crypto');
const path = require('node:path');
function createFileQueue({ offer, emit }) {
  let queued = [], active, epoch = 0;
  const report = () => emit(queued.map(({ id, source }) => ({ id, name: path.basename(source) })));
  async function next() {
    if (active || !queued.length) return;
    active = queued.shift(); report();
    const item = active, generation = epoch;
    try { await offer(item.source); }
    catch { if (epoch === generation && active === item) { active = undefined; next(); } }
  }
  return {
    add(paths) {
      if (!Array.isArray(paths) || !paths.length || paths.length + queued.length + Number(Boolean(active)) > 100 || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0'))) throw new Error('Escolha até 100 arquivos por fila.');
      queued.push(...paths.map(source => ({ id: randomUUID(), source })));
      report(); next();
    },
    observe(state) {
      if (state.direction === 'outgoing' && ['done', 'declined', 'cancelled', 'error'].includes(state.status)) {
        active = undefined;
        const generation = epoch;
        setImmediate(() => { if (generation === epoch) next(); });
      }
    },
    remove(id) { queued = queued.filter(item => item.id !== id); report(); },
    clear() { epoch++; queued = []; report(); },
    reset() { epoch++; queued = []; active = undefined; report(); }
  };
}
module.exports = { createFileQueue };
