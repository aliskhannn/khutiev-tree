import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const data = Object.fromEntries(['people', 'history'].map(name => [name, JSON.parse(read('data/' + name + '.json'))]));
data.people.push(...JSON.parse(read('data/published-additions.json')));
data.historyInh = JSON.parse(read('data/history.inh.json'));
data.sources = JSON.parse(read('data/sources.json'));
const assets = Object.fromEntries(['index.html', 'style.css', 'app.js', 'i18n-inh.js', 'tree-map.js', 'tree-export.js', 'vendor/d3.v7.min.js', 'vendor/jspdf.umd.min.js', 'vendor/dejavu-sans.b64'].map(name => [name, read('public/' + name)]));
assets['layout.json'] = read('data/layout.json');
const target = join(root, 'dist');
mkdirSync(join(target, 'server'), { recursive: true });
mkdirSync(join(target, '.openai'), { recursive: true });
if (existsSync(join(root, '.openai/hosting.json'))) {
  copyFileSync(join(root, '.openai/hosting.json'), join(target, '.openai/hosting.json'));
}
const worker = [
  read('server/api.mjs'),
  read('server/site.mjs'),
  'const familyData = ' + JSON.stringify(data) + ';',
  'const siteAssets = ' + JSON.stringify(assets) + ';',
  'export default { fetch(request, env) { return serveSite(request, env, familyData, name => siteAssets[name], handleApi); } };',
];
writeFileSync(join(target, 'server/index.js'), worker.join('\n'));
console.log('Сборка готова. Записей в родословной — ' + data.people.length);
