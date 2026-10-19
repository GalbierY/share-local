const fs = require('node:fs');
const path = require('node:path');

function parseRepository(input) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(input || '');
  if (!match || match[2] === '.' || match[2] === '..') throw new Error('Use o link do repositório: https://github.com/SEU-USUARIO/SEU-REPOSITORIO');
  return { provider: 'github', owner: match[1], repo: match[2], releaseType: 'release' };
}
if (require.main === module) {
  try {
    const publish = parseRepository(process.argv[2]);
    const target = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(target, 'utf8'));
    pkg.build.publish = [publish];
    fs.writeFileSync(target, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`Atualizações configuradas: https://github.com/${publish.owner}/${publish.repo}/releases`);
    console.log('Use um repositório público para o aplicativo baixar sem login. Nenhum token vai no instalador.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { parseRepository };
