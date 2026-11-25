import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi } from './api.mjs';
import { openDatabase } from './sqlite.mjs';

function setup(t) {
  const env = {
    DB: openDatabase(),
    EDITOR_CODE: crypto.randomUUID(),
    SESSION_SECRET: crypto.randomUUID(),
  };
  t.after(() => env.DB.close());
  const people = [
    { id: 'khuti', name: 'Хути', parent: null },
    { id: 'one', name: 'Татар', parent: 'khuti' },
    { id: 'two', name: 'Татар', parent: 'one' },
    { id: 'three', name: 'Имя', parent: 'two' },
    { id: 'four', name: 'Имя', parent: 'three' },
  ];
  const origin = 'https://family.example';
  function call(path, { cookie, body, from = origin } = {}) {
    const headers = new Headers();
    const method = body === undefined ? 'GET' : 'POST';
    if (cookie) headers.set('Cookie', cookie);
    if (method === 'POST') {
      headers.set('Origin', from);
      headers.set('Content-Type', 'application/json');
    }
    return handleApi(new Request(origin + path, {
      method, headers, body: JSON.stringify(body),
    }), env, { people, history: [] });
  }
  async function login(code) {
    const response = await call('/api/login', { body: { code } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('Set-Cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /SameSite=Strict/);
    return cookie.split(';')[0];
  }
  return { env, people, call, login };
}

test('anonymous visitors see every generation while only editors can review', async t => {
  const { env, people, call, login } = setup(t);
  const guest = await (await call('/api/tree')).json();
  assert.equal(guest.access, 'guest');
  assert.deepEqual(guest.people, people);
  assert.equal((await call('/api/proposals')).status, 403);
  assert.equal((await call('/api/login', { body: { code: 'unknown' } })).status, 401);
  assert.equal((await call('/api/login', {
    body: { code: env.EDITOR_CODE }, from: 'https://other.example',
  })).status, 403);
  const cookie = await login(env.EDITOR_CODE);
  const member = await (await call('/api/tree', { cookie })).json();
  assert.equal(member.access, 'editor');
  assert.deepEqual(member.people, people);
  assert.equal((await call('/api/proposals', { cookie })).status, 200);
  env.EDITOR_CODE = crypto.randomUUID();
  assert.equal((await (await call('/api/tree', { cookie })).json()).access, 'guest');
});

test('submission retries and review decisions preserve one child and its correct parent', async t => {
  const { env, call, login } = setup(t);
  const editor = await login(env.EDITOR_CODE);
  const proposal = { parent: 'two', name: 'Пример', note: 'Семейная запись' };
  const submit = body => call('/api/proposals', { body });
  assert.equal((await submit({ ...proposal, parent: 'missing' })).status, 404);
  const submissions = await Promise.all([submit(proposal), submit(proposal)]);
  assert.deepEqual(submissions.map(r => r.status), [200, 200]);
  const results = await Promise.all(submissions.map(response => response.json()));
  assert.equal(results[0].id, results[1].id);
  const { id } = results[0];
  const ids = async cookie => (await (await call('/api/tree', { cookie })).json()).people.map(p => p.id);
  assert.ok(!(await ids()).includes(id));
  const queue = await (await call('/api/proposals', { cookie: editor })).json();
  assert.deepEqual(queue.items, [{ id, ...proposal, status: 'pending' }]);
  const review = (decision, cookie = editor) => call('/api/proposals/' + id, { cookie, body: { decision } });
  assert.equal((await review('approve', '')).status, 403);
  assert.equal((await review('approve')).status, 200);
  assert.equal((await review('approve')).status, 200);
  assert.equal((await review('reject')).status, 409);
  const tree = await (await call('/api/tree', {})).json();
  assert.deepEqual(tree.people.filter(p => p.id === id), [{ id, name: proposal.name, parent: 'two' }]);
  assert.ok((await ids()).includes(id));
  const descendant = await (await submit({ parent: id, name: 'Внук' })).json();
  assert.equal(descendant.status, 'pending');
  assert.equal((await call('/api/proposals/' + descendant.id, {
    cookie: editor, body: { decision: 'reject' },
  })).status, 200);
  assert.ok(!(await ids()).includes(descendant.id));
});

test('name corrections retain the person and links, are moderated, and detect competing changes', async t => {
  const { env, people, call, login } = setup(t);
  const editor = await login(env.EDITOR_CODE);
  const nameOf = async id => (await (await call('/api/tree')).json()).people.find(p => p.id === id);
  const base = { person: 'two', before: 'Татар', revision: 0, name: 'Мансур' };
  const submit = (body, cookie) => call('/api/name-changes', { body, cookie });
  const decide = (id, decision, cookie) => call('/api/proposals/' + id, { body: { decision }, cookie });
  assert.equal((await submit({ ...base, publish: true })).status, 403);
  assert.equal((await submit({ ...base, person: 'missing' })).status, 404);
  const queued = await (await submit(base)).json();
  const alternative = await (await submit({ ...base, name: 'Муслим' })).json();
  assert.equal(queued.status, 'pending');
  assert.deepEqual(await (await submit(base)).json(), queued);
  assert.deepEqual(await nameOf('two'), people[2]);
  assert.equal((await decide(queued.id, 'approve')).status, 403);
  assert.equal((await decide(queued.id, 'approve', editor)).status, 200);
  assert.deepEqual(await nameOf('two'), { ...people[2], name: 'Мансур', nameRevision: 1 });
  assert.deepEqual(await nameOf('three'), people[3]);
  assert.equal((await decide(alternative.id, 'approve', editor)).status, 409);
  assert.equal((await decide(alternative.id, 'reject', editor)).status, 200);
  assert.equal((await submit({ ...base, name: 'Магомед' }, editor)).status, 409);
  const direct = { ...base, before: 'Мансур', revision: 1, name: 'Магомед', publish: true };
  const saved = await (await submit(direct, editor)).json();
  assert.equal(saved.status, 'approved');
  assert.deepEqual(await (await submit(direct, editor)).json(), saved);
  assert.deepEqual(await nameOf('two'), { ...people[2], name: 'Магомед', nameRevision: 2 });
  const added = await (await call('/api/proposals', { body: { parent: 'two', name: 'Мамсур' } })).json();
  await decide(added.id, 'approve', editor);
  const renamedChild = await submit({ ...base, person: added.id, before: 'Мамсур' }, editor);
  assert.equal((await renamedChild.json()).status, 'approved');
  assert.deepEqual(await nameOf(added.id), { id: added.id, parent: 'two', name: 'Мансур', nameRevision: 1 });
});
