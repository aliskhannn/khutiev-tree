const cookieName = 'khutiev_access';
const sessionLifetime = 60 * 60 * 24 * 14;
const encoder = new TextEncoder();
const allowedNames = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’ʼ()\-–—]*$/u;

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function failure(message, status) {
  return json({ error: message }, status);
}

function cookie(request, value, lifetime) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${lifetime}${secure}`;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function authConfigured(env) {
  return env.SESSION_SECRET && env.EDITOR_CODE;
}

async function sessionKey(env, role) {
  const accessCode = env.EDITOR_CODE;
  return crypto.subtle.importKey(
    'raw', encoder.encode(JSON.stringify([env.SESSION_SECRET, role, accessCode])),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

async function sessionCookie(request, env, role) {
  const expiry = Math.floor(Date.now() / 1000) + sessionLifetime;
  const message = `${role}.${expiry}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env, role), encoder.encode(message));
  return cookie(request, `${message}.${hex(signature)}`, sessionLifetime);
}

async function accessRole(request, env) {
  if (!authConfigured(env)) return 'guest';
  const token = (request.headers.get('Cookie') || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  const matched = /^(editor)\.(\d{10,12})\.([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(token);
  if (!matched || Number(matched[2]) <= Math.floor(Date.now() / 1000)) return 'guest';
  const [, role, expiry, nonce, hexSignature] = matched;
  const signature = Uint8Array.from(hexSignature.match(/../g), byte => parseInt(byte, 16));
  const valid = await crypto.subtle.verify(
    'HMAC', await sessionKey(env, role), signature, encoder.encode(`${role}.${expiry}.${nonce}`),
  );
  return valid ? role : 'guest';
}

async function parseForm(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return failure('Откройте форму на сайте родословной.', 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return failure('Отправьте заполненную форму.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) return failure('Заполните форму.', 400);
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 16384) {
      await reader.cancel();
      return failure('Текст слишком длинный.', 413);
    }
    chunks.push(part.value);
  }
  try {
    const body = await new Blob(chunks).text();
    const result = JSON.parse(body);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  } catch {
    // Incomplete or malformed submissions should leave the tree untouched.
  }
  return failure('Не удалось прочитать форму.', 400);
}

function normalized(text) {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

async function submitProposal(env, data, input) {
  const { parent } = input;
  if (typeof parent !== 'string' || !parent || parent.length > 160) {
    return failure('Выберите отца в древе.', 400);
  }
  const name = typeof input.name === 'string' ? normalized(input.name) : '';
  if (!allowedNames.test(name) || name.length > 120) {
    return failure('Проверьте имя сына. Допустимо до 120 символов.', 400);
  }
  if (input.note != null && typeof input.note !== 'string') {
    return failure('Проверьте пояснение к заявке.', 400);
  }
  const note = (input.note || '').normalize('NFC').trim();
  if (note.length > 1000) return failure('Сократите пояснение до 1000 символов.', 400);
  const originalParent = data.people.some(person => person.id === parent);
  if (!originalParent) {
    const approvedParent = await env.DB.prepare(
      "SELECT id FROM family_proposals WHERE id = ? AND status = 'approved'",
    ).bind(parent).first();
    if (!approvedParent) return failure('Отец не найден в древе.', 404);
  }

  const identity = JSON.stringify([parent, name.toLowerCase(), normalized(note).toLowerCase()]);
  const key = hex(await crypto.subtle.digest('SHA-256', encoder.encode(identity)));
  const row = await env.DB.prepare(`
    INSERT INTO family_proposals (id, parent, name, note, request_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (request_key) WHERE status != 'rejected'
    DO UPDATE SET request_key = excluded.request_key
    RETURNING id, status
  `).bind('family-' + crypto.randomUUID(), parent, name, note, key, Date.now()).first();
  return json(row);
}

async function reviewProposal(env, id, decision) {
  const next = { approve: 'approved', reject: 'rejected' };
  if (decision !== 'approve' && decision !== 'reject') return failure('Выберите решение.', 400);
  const status = next[decision];
  // An approved row is the additional person. A single conditional update
  // both records the decision and makes this person visible to the family.
  const row = await env.DB.prepare(`
    UPDATE family_proposals SET status = ?, reviewed_at = ?
    WHERE id = ? AND status = 'pending' RETURNING id, status
  `).bind(status, Date.now(), id).first();
  if (row) return json(row);
  const existing = await env.DB.prepare('SELECT id, status FROM family_proposals WHERE id = ?').bind(id).first();
  if (!existing) return failure('Заявка не найдена.', 404);
  return existing.status === status ? json(existing) : failure('По этой заявке уже принято другое решение.', 409);
}

const staleName = 'Имя уже изменилось. Откройте карточку заново.';

async function reviewNameChange(env, id, decision) {
  if (!['approve', 'reject'].includes(decision)) return failure('Выберите решение.', 400);
  const status = decision === 'approve' ? 'approved' : 'rejected';
  let updated;
  try {
    updated = await env.DB.prepare(`
    UPDATE family_name_changes AS change SET status = ?
    WHERE id = ? AND status = 'pending' AND (
      ? = 'rejected' OR base_revision = (
        SELECT COALESCE(MAX(prior.base_revision) + 1, 0) FROM family_name_changes AS prior
        WHERE prior.person_id = change.person_id AND prior.status = 'approved'
      )
    ) RETURNING id, status
    `).bind(status, id, status).first();
  } catch (error) {
    if (error.code === '23505' && error.constraint_name === 'family_name_change_revision') return failure(staleName, 409);
    throw error;
  }
  if (updated) return json(updated);
  const existing = await env.DB.prepare('SELECT id, status FROM family_name_changes WHERE id = ?').bind(id).first();
  if (!existing) return failure('Заявка не найдена.', 404);
  if (existing.status === status) return json(existing);
  return failure(existing.status === 'pending' ? staleName : 'По этой заявке уже принято другое решение.', 409);
}

async function submitNameChange(env, data, input, access) {
  if (input.publish && access !== 'editor') return failure('Для проверки заявок войдите как редактор.', 403);
  const { person, before, revision } = input;
  const name = typeof input.name === 'string' ? normalized(input.name) : '';
  if (!allowedNames.test(name) || name.length > 120) return failure('Проверьте написание имени.', 400);
  if (!Number.isSafeInteger(revision) || revision < 0 || typeof before !== 'string') return failure(staleName, 409);
  if (before === name) return failure('Введите исправленное имя.', 400);
  if (typeof person !== 'string' || person.length > 160) return failure('Запись не найдена', 404);
  const original = data.people.find(p => p.id === person) || await env.DB.prepare(
    "SELECT name FROM family_proposals WHERE id = ? AND status = 'approved'",
  ).bind(person).first();
  if (!original) return failure('Запись не найдена', 404);
  // Check the version in the write itself so two editors cannot replace each other's work.
  const row = await env.DB.prepare(`
    WITH latest AS (
      SELECT name, base_revision + 1 AS revision FROM family_name_changes
      WHERE person_id = ? AND status = 'approved' ORDER BY base_revision DESC LIMIT 1
    )
    INSERT INTO family_name_changes (id, person_id, base_revision, before_name, name, created_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ? = COALESCE((SELECT revision FROM latest), 0)
      AND ? = COALESCE((SELECT name FROM latest), ?)
    ON CONFLICT (person_id, base_revision, name) WHERE status != 'rejected'
    DO UPDATE SET name = excluded.name RETURNING id, status
  `).bind(person, 'rename-' + crypto.randomUUID(), person, revision, before, name,
    Date.now(), revision, before, original.name).first();
  if (!row) {
    const retry = await env.DB.prepare(`
      SELECT id, status FROM family_name_changes AS change WHERE person_id = ? AND base_revision = ?
        AND before_name = ? AND name = ? AND status = 'approved' AND NOT EXISTS (
          SELECT 1 FROM family_name_changes AS newer WHERE newer.person_id = change.person_id
          AND newer.status = 'approved' AND newer.base_revision > change.base_revision
        )
    `).bind(person, revision, before, name).first();
    return retry ? json(retry) : failure(staleName, 409);
  }
  return access === 'editor' ? reviewNameChange(env, row.id, 'approve') : json(row);
}

async function route(request, env, data) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') return failure('Метод не поддерживается.', 405);
  let input;
  if (method === 'POST') {
    input = await parseForm(request);
    if (input instanceof Response) return input;
    if (path === '/api/logout') return json({ access: 'guest' }, 200, { 'Set-Cookie': cookie(request, '', 0) });
    if (path === '/api/login') {
      if (!authConfigured(env)) return failure('Вход ещё не настроен.', 503);
      const code = typeof input.code === 'string' ? input.code.trim() : '';
      const role = code === env.EDITOR_CODE ? 'editor' : 'guest';
      if (role === 'guest') return failure('Пароль редактора не подошёл.', 401);
      return json({ access: role }, 200, { 'Set-Cookie': await sessionCookie(request, env, role) });
    }
  }
  const access = await accessRole(request, env);
  if (method === 'GET' && path === '/api/tree') {
    const approved = await env.DB.prepare(
      "SELECT id, name, parent FROM family_proposals WHERE status = 'approved' ORDER BY created_at, id",
    ).all();
    const changes = await env.DB.prepare(`
      SELECT person_id, name, base_revision + 1 AS revision FROM family_name_changes AS change
      WHERE status = 'approved' AND NOT EXISTS (
        SELECT 1 FROM family_name_changes AS newer WHERE newer.person_id = change.person_id
        AND newer.status = 'approved' AND newer.base_revision > change.base_revision
      )
    `).all();
    const names = new Map(changes.results.map(row => [row.person_id, row]));
    // A published snapshot may already include people approved in the local database.
    const known = new Map(data.people.map(p => [p.id, p]));
    for (const person of approved.results) known.set(person.id, person);
    const people = Array.from(known.values(), p => {
      const change = names.get(p.id);
      return change ? { ...p, name: change.name, nameRevision: change.revision } : p;
    });
    return json({ people, history: data.history, historyInh: data.historyInh, sources: data.sources, access });
  }
  if (method === 'POST' && path === '/api/proposals') return submitProposal(env, data, input);
  if (method === 'POST' && path === '/api/name-changes') return submitNameChange(env, data, input, access);
  if (access !== 'editor') return failure('Для проверки заявок войдите как редактор.', 403);
  if (method === 'GET' && path === '/api/proposals') {
    const items = await env.DB.prepare(`
      SELECT * FROM (
        SELECT id, parent, name, note, status, created_at, NULL AS person, NULL AS before_name FROM family_proposals
        UNION ALL
        SELECT id, NULL, name, NULL, status, created_at, person_id, before_name FROM family_name_changes
      ) AS requests ORDER BY (status = 'pending') DESC, created_at DESC, id
    `).all();
    return json({ items: items.results.map(({ created_at, person, before_name, ...row }) =>
      person ? { id: row.id, status: row.status, person, before: before_name, name: row.name } : row) });
  }
  const renamePath = /^\/api\/proposals\/(rename-[0-9a-f-]{36})$/.exec(path);
  if (method === 'POST' && renamePath) return reviewNameChange(env, renamePath[1], input.decision);
  const reviewPath = /^\/api\/proposals\/(family-[0-9a-f-]{36})$/.exec(path);
  if (method === 'POST' && reviewPath) return reviewProposal(env, reviewPath[1], input.decision);
  return failure('Страница не найдена.', 404);
}

export async function handleApi(request, env, data) {
  try {
    return await route(request, env, data);
  } catch (error) {
    console.error('Family API request failed', error?.name || 'Error');
    return failure('Не удалось выполнить запрос. Попробуйте ещё раз.', 503);
  }
}
