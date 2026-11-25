const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/i18n-inh.js', ['i18n-inh.js', 'text/javascript']],
  ['/tree-map.js', ['tree-map.js', 'text/javascript']],
  ['/tree-export.js', ['tree-export.js', 'text/javascript']],
  ['/vendor/jspdf.umd.min.js', ['vendor/jspdf.umd.min.js', 'text/javascript']],
  ['/vendor/dejavu-sans.b64', ['vendor/dejavu-sans.b64', 'text/plain']],
  ['/vendor/d3.v7.min.js', ['vendor/d3.v7.min.js', 'text/javascript']],
  ['/layout.json', ['layout.json', 'application/json']],
]);

export async function serveSite(request, env, records, asset, api) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith('/api/')) {
    try {
      return await api(request, env, records);
    } catch (error) {
      console.error('Ошибка API:', error.name);
      return Response.json({ error: 'Не удалось обработать запрос. Попробуйте ещё раз.' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const file = files.get(pathname);
  if (!file) return new Response('Страница не найдена', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : await asset(file[0]), {
    headers: {
      'Content-Type': file[1] + '; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'",
    },
  });
}
