import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { handleApi } from './api.mjs';
import { serveSite } from './site.mjs';

const base = fileURLToPath(new URL('../', import.meta.url));

export function startServer(env, { host, protocol = 'http:' }) {
  const load = file => JSON.parse(readFileSync(join(base, 'data', file + '.json'), 'utf8'));
  const data = { people: load('people'), history: load('history'), historyInh: load('history.inh'), sources: load('sources') };
  const assets = name => readFileSync(join(base, name === 'layout.json' ? 'data' : 'public', name));
  data.people.push(...load('published-additions'));
  const port = Number(process.env.PORT || 4178);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const origin = process.env.FAMILY_ORIGIN || protocol + '//' + incoming.headers.host;
      const url = new URL(incoming.url, origin);
      if (url.origin !== new URL(origin).origin) {
        outgoing.writeHead(400).end();
        return;
      }
      const init = { method: incoming.method, headers: incoming.headers };
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        init.body = Readable.toWeb(incoming);
        init.duplex = 'half';
      }
      const response = await serveSite(new Request(url, init), env, data, assets, handleApi);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Ошибка запроса:', error.name);
      outgoing.writeHead(400).end();
    }
  });
  server.requestTimeout = 15000;
  server.on('error', error => {
    console.error('Сервер не запустился:', error.message);
    process.exitCode = 1;
    env.DB.close();
  });
  server.listen(port, host, () => {
    console.log('Родословная Хутиевых — http://' + host + ':' + server.address().port);
  });
}
