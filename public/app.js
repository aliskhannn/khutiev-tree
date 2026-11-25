"use strict";

const $ = (id) => document.getElementById(id);
const sections = ["tree", "history", "stats", "review"];
let lang = "inh";
try {
  if (localStorage.getItem("khutiev-language") === "ru") lang = "ru";
} catch {}
const t = (key) => (lang === "ru" ? key : window.INGUSH_TEXT[key] || key);
const languageOptions = Array.from($("language-menu").children);

const icons = {
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  tree: '<path d="M12 22V3m0 14-7-5V6m7 7 7-5V4"/><circle cx="5" cy="5" r="1.3"/><circle cx="19" cy="3" r="1.3"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  key: '<circle cx="8" cy="9" r="4"/><path d="m11 12 7 7 3-3-2-2-2 2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  pencil: '<path d="m4 16-.8 4.8 4.8-.8L20 8a2 2 0 0 0-4-4Z"/><path d="m14 6 4 4"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M3 9V4h5m8 0h5v5m0 6v5h-5m-8 0H3v-5"/>',
};
document.querySelectorAll("[data-icon]").forEach((node) => {
  node.className = "icon";
  node.setAttribute("aria-hidden", "true");
  node.innerHTML =
    '<svg viewBox="0 0 24 24">' + icons[node.dataset.icon] + "</svg>";
});
function localize() {
  document.documentElement.lang = lang;
  for (const option of languageOptions) {
    option.setAttribute("aria-checked", String(option.lang === lang));
    if (option.lang === lang) $("language-value").textContent = option.textContent.trim();
  }
  document
    .querySelectorAll("[data-t]")
    .forEach((node) => (node.textContent = t(node.dataset.t)));
  for (const [attr, dest] of [
    ["label", "aria-label"],
    ["placeholder", "placeholder"],
    ["title", "title"],
  ]) {
    document.querySelectorAll("[data-" + attr + "]").forEach((node) => {
      const value = t(node.dataset[attr]);
      node.setAttribute(dest, value);
      if (attr === "title") node.setAttribute("aria-label", value);
    });
  }
}
localize();
function setLargeText(enabled) {
  $("tree-pane").classList.toggle("large-text", enabled);
  $("large-text").setAttribute("aria-pressed", String(enabled));
  map?.invalidate();
}
function el(tag, value, cls) {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}
function action(key, callback, primary = false) {
  const node = el("button", t(key), primary ? "button primary" : "button");
  node.type = "button";
  node.addEventListener("click", callback);
  return node;
}
function link(text, hash, cls) {
  const node = el("a", text, cls);
  node.href = hash;
  return node;
}
const personHref = (id) => "#person=" + encodeURIComponent(id);
const branchHref = (id) => "#branch=" + encodeURIComponent(id);
const personLink = (p) => link(p.name, personHref(p.id));
const normalize = (s) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ӏӀi1|]/g, "ӏ")
    .replace(/ё/g, "е")
    .trim();
const data = {
  people: [],
  byId: new Map(),
  children: new Map(),
  depth: new Map(),
  descendants: new Map(),
  generations: [],
  root: null,
  history: [],
  historyInh: [],
  sources: [],
  access: "guest",
};
let map = null,
  section = "tree",
  currentId = null,
  requestsVersion = 0,
  loadVersion = 0,
  searchLimit = 25;
let previousRoute = null,
  layoutPromise = null;
function assignPeople(people) {
  data.people = people;
  data.byId = new Map(people.map((p) => [p.id, p]));
  data.children = new Map();
  data.depth = new Map();
  data.descendants = new Map();
  data.generations = [];
  for (const p of people) {
    if (!p.parent) continue;
    if (!data.children.has(p.parent)) data.children.set(p.parent, []);
    data.children.get(p.parent).push(p);
  }
  data.root = people.find((p) => p.parent === null);
  if (!data.root) throw Error(t("Не удалось загрузить данные"));
  const ordered = [data.root];
  data.depth.set(data.root.id, 1);
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i],
      depth = data.depth.get(p.id);
    data.generations[depth - 1] = (data.generations[depth - 1] || 0) + 1;
    for (const child of kids(p.id)) {
      data.depth.set(child.id, depth + 1);
      ordered.push(child);
    }
  }
  for (let i = ordered.length - 1; i >= 0; i--) {
    const p = ordered[i];
    data.descendants.set(
      p.id,
      kids(p.id).reduce(
        (count, child) => count + 1 + data.descendants.get(child.id),
        0,
      ),
    );
  }
}
const kids = (id) => data.children.get(id) || [];
function ancestors(p) {
  const chain = [];
  while (p) {
    chain.unshift(p);
    p = data.byId.get(p.parent);
  }
  return chain;
}
async function api(path, body) {
  const options = { credentials: "same-origin", cache: "no-store" };
  if (body !== undefined) {
    options.method = "POST";
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options).catch(() => {
    throw Error(t("Не удалось отправить запрос"));
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const original = payload.error || "";
    const short = original.replace(/[.!]$/, "");
    const message = window.INGUSH_TEXT[original] ? original : short;
    const error = Error(
      lang === "ru" && message
        ? message
        : t(
            window.INGUSH_TEXT[message]
              ? message
              : "Не удалось отправить запрос",
          ),
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}
async function load({ preserve = false } = {}) {
  const version = ++loadVersion;
  $("load-error").hidden = true;
  try {
    layoutPromise ??= fetch("/layout.json")
      .then((r) => {
        if (!r.ok) throw Error(t("Не удалось загрузить данные"));
        return r.json();
      })
      .catch((err) => {
        layoutPromise = null;
        throw err;
      });
    const [tree, layout] = await Promise.all([api("/api/tree"), layoutPromise]);
    if (version !== loadVersion) return;
    const changed = tree.people.length !== data.people.length || !data.root;
    const renamed = !changed && tree.people.some(p => data.byId.get(p.id)?.name !== p.name);
    assignPeople(tree.people);
    data.access = tree.access;
    data.history = tree.history;
    data.historyInh = tree.historyInh;
    data.sources = tree.sources;
    $("loading").hidden = true;
    if (!map) {
      $("tree-pane").hidden = false;
      map = new FamilyTreeMap($("diagram"), {
        t,
        onSelect: (id) => (id ? visit(personHref(id)) : dismissPerson()),
        onZoom: (percent) => ($("zoom-value").textContent = percent + "%"),
      });
    }
    if (changed || renamed) map.setData(data.people, layout);
    updateChrome();
    renderHistory();
    renderStats();
    route({ preserve: preserve && !changed });
  } catch (err) {
    if (version !== loadVersion) return;
    $("loading").hidden = true;
    $("load-error").hidden = false;
    $("load-message").textContent = t("Не удалось загрузить данные");
    throw err;
  }
}
function setGenerationColors(node, number) {
  const { fill, text } = FamilyTreeMap.generationColor(number);
  node.style.setProperty("--gen-fill", fill);
  node.style.setProperty("--gen-text", text);
}
function updateChrome() {
  $("nav-review").hidden = data.access !== "editor";
  const title = t(data.access === "editor" ? "Редактор" : "Вход редактора");
  $("account").title = title;
  $("account").setAttribute("aria-label", title);
  $("map-count").textContent = t("Всего людей") + " · " + data.people.length;
  $("generation-count").textContent = t("Поколения") + " · " + data.generations.length;
  $("generation-swatches").replaceChildren(...data.generations.map((_, index) => {
    const number = index + 1;
    const swatch = el("li", String(number), "generation-chip");
    swatch.setAttribute("aria-label", t("Поколение") + " " + number);
    setGenerationColors(swatch, number);
    return swatch;
  }));
  const links = $("branch-links");
  links.replaceChildren();
  for (const branch of kids(data.root.id)) {
    const a = link(
      "",
      branchHref(branch.id),
      "branch-link branch-" + branch.id,
    );
    a.append(el("i", null, "branch-dot"), document.createTextNode(branch.name));
    links.append(a);
  }
}
function metric(label, value, description) {
  const group = el("dl");
  group.append(el("dt", t(label)), el("dd", String(value)));
  if (description) group.append(el("dd", null, "metric-note"));
  if (description) group.lastChild.append(el("p", t(description)));
  return group;
}
function renderStats() {
  $("totals").replaceChildren(
    metric("Всего людей", data.people.length),
    metric("Поколения", data.generations.length),
    metric(
      "Предки",
      data.children.size,
      "Мужчины, у которых в древе записан хотя бы один сын.",
    ),
  );
  const rows = $("generations");
  rows.replaceChildren();
  const maximum = Math.max(...data.generations);
  data.generations.forEach((count, i) => {
    const row = el("div", null, "generation"),
      meter = el("meter");
    setGenerationColors(row, i + 1);
    meter.min = 0;
    meter.max = maximum;
    meter.value = count;
    meter.setAttribute("aria-label", t("Поколение") + " " + (i + 1));
    row.append(el("span", String(i + 1), "generation-chip"), meter, el("data", String(count)));
    rows.append(row);
  });
  const branches = $("branch-stats");
  branches.replaceChildren();
  for (const b of kids(data.root.id)) {
    const a = link("", branchHref(b.id), "branch-stat branch-" + b.id),
      name = el("span");
    name.append(el("i", null, "branch-dot"), document.createTextNode(b.name));
    a.append(name, el("strong", String(1 + data.descendants.get(b.id))));
    branches.append(a);
  }
}
function relations(target, label, people) {
  const node = $(target);
  node.replaceChildren();
  node.hidden = people.length === 0;
  if (!people.length) return;
  node.append(el("span", t(label)));
  people.forEach((p, i) => {
    if (i) node.append(", ");
    node.append(personLink(p));
  });
}
function renderPerson(p) {
  currentId = p.id;
  $("person-panel").hidden = false;
  $("person-name").textContent = p.name;
  const facts = $("person-facts");
  facts.replaceChildren();
  for (const [label, n] of [
    ["Поколение", data.depth.get(p.id)],
    ["Предки", data.depth.get(p.id) - 1],
    ["Потомки", data.descendants.get(p.id)],
  ]) {
    const div = el("div", null, "fact");
    const value = el("strong", String(n));
    if (label === "Поколение") {
      value.className = "generation-chip";
      setGenerationColors(value, n);
    }
    div.append(value, el("small", t(label)));
    facts.append(div);
  }
  relations(
    "parent-block",
    "Отец",
    p.parent ? [data.byId.get(p.parent)] : [],
  );
  relations("child-block", "Сыновья", kids(p.id));
  const chain = ancestors(p);
  $("ancestry").hidden = chain.length <= 1;
  const lineage = $("lineage");
  lineage.replaceChildren();
  chain.forEach((v, i) => {
    if (i) lineage.append(" › ");
    lineage.append(v.id === p.id ? el("span", v.name) : personLink(v));
  });
}
function closeSheet() {
  currentId = null;
  $("person-panel").hidden = true;
  $("ancestry").open = false;
  map?.select(null);
}
function dismissPerson() {
  if (!currentId) return;
  closeSheet();
  history.replaceState(null, "", "#tree");
  previousRoute = location.hash;
  document.title = t("Родословная Хутиевых");
  $("diagram").focus({ preventScroll: true });
}
function renderHistory() {
  const article = $("article"),
    contents = $("contents");
  article.replaceChildren();
  contents.replaceChildren();
  function addSection(title, paragraphs, id, refs = []) {
    const sec = el("section");
    sec.id = "article-" + id;
    sec.append(el("h2", title));
    for (const paragraph of paragraphs) sec.append(el("p", paragraph));
    for (const ref of refs) {
      const a = link(ref.text, ref.url, "source-link");
      a.target = "_blank";
      a.rel = "noreferrer";
      sec.append(a);
    }
    article.append(sec);
    contents.append(link(title, "#" + id));
  }
  const primary = lang === "inh" ? data.historyInh : data.history;
  const coggle = "https://coggle.it/diagram/XcQ0fJL8UlFIQ2zq/t/хути-silhouette";
  // Show provenance separately from the family's own transcription.
  article.append(el("p", t("Семейная запись"), "article-label"));
  primary.forEach((s, i) =>
    addSection(
      s.title,
      s.paragraphs,
      "history-" + (i + 1),
      i === 0 ? [{ text: "Coggle", url: coggle }] : [],
    ),
  );
  if (data.sources.length)
    article.append(
      el("p", t("Источники"), "article-label"),
    );
  data.sources.forEach((s, i) =>
    addSection(
      s.title[lang],
      s.paragraphs.map((p) => p[lang]),
      "source-" + (i + 1),
      [{ text: s.label[lang], url: s.url }],
    ),
  );
}
function visit(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function route({ preserve = false } = {}) {
  if (!data.root) return;
  if (location.hash === "#editor") {
    const signedIn = data.access === "editor";
    history.replaceState(null, "", signedIn ? "#review" : "#tree");
    route({ preserve: true });
    if (!signedIn) account();
    return;
  }
  const hash = location.hash.slice(1);
  section = /^(history|source)(-\d+)?$/.test(hash)
    ? "history"
    : hash === "stats"
      ? "stats"
      : hash === "review" && data.access === "editor"
        ? "review"
        : "tree";
  for (const view of sections) {
    $(view + "-pane").hidden = view !== section;
    if (view === section) $("nav-" + view).setAttribute("aria-current", "page");
    else $("nav-" + view).removeAttribute("aria-current");
  }
  const sameHash = previousRoute === location.hash;
  previousRoute = location.hash;
  clearSearch();
  document
    .querySelectorAll(".branch-link[aria-current]")
    .forEach((a) => a.removeAttribute("aria-current"));
  document.title = t("Родословная Хутиевых");
  if (section !== "tree") {
    if (section === "history" && hash !== "history")
      $("article-" + hash)?.scrollIntoView({ block: "start" });
    if (section === "review") loadReview();
    return;
  }
  map.resize();
  let id = "";
  try {
    id = decodeURIComponent(hash.slice(hash.indexOf("=") + 1));
  } catch {}
  const person = data.byId.get(id);
  if (hash.startsWith("person=") && person) {
    renderPerson(person);
    map.select(id);
    if (!(preserve && sameHash))
      map.focusPerson(id, {
        openPanel: true,
        animate: sameHash || Boolean(location.hash),
      });
    document.title = person.name + " · " + t("Родословная Хутиевых");
    $("announcement").textContent = person.name;
  } else {
    closeSheet();
    if (hash.startsWith("branch=") && person?.parent === data.root.id) {
      document
        .querySelector('.branch-link[href="' + branchHref(id) + '"]')
        ?.setAttribute("aria-current", "true");
      if (!(preserve && sameHash)) map.focusBranch(id);
    } else {
      if (!(preserve && sameHash)) map.fit(false);
      if (hash.startsWith("person=") || hash.startsWith("branch="))
        $("announcement").textContent = t("Запись не найдена");
    }
  }
}
function search() {
  const query = normalize($("search-input").value);
  $("search-pane").hidden = !query;
  $("clear-query").hidden = !query;
  $("search-hint").hidden = !!query;
  if (!query) return;
  const matches = data.people
    .filter((p) => normalize(p.name).includes(query))
    .sort(
      (a, b) =>
        Number(normalize(b.name) === query) -
          Number(normalize(a.name) === query) ||
        a.name.localeCompare(b.name, "ru"),
    );
  $("search-count").textContent = matches.length
    ? t("Найдено") + " · " + matches.length
    : t("Совпадений нет");
  const results = $("results");
  results.replaceChildren();
  for (const p of matches.slice(0, searchLimit)) {
    const a = link("", personHref(p.id), "result");
    a.append(
      el("strong", p.name),
      el(
        "small",
        ancestors(p)
          .slice(0, -1)
          .map((v) => v.name)
          .join(" › ") || t("Начало родословной"),
      ),
    );
    results.append(a);
  }
  $("more").hidden = matches.length <= searchLimit;
}
function clearSearch() {
  $("search-input").value = "";
  searchLimit = 25;
  search();
}

const dialog = $("form-dialog");
function startDialog(key) {
  const body = $("dialog-body");
  body.replaceChildren();
  $("dialog-title").textContent = t(key);
  if (!dialog.open) dialog.showModal();
  return body;
}
function field(key, kind, options) {
  const label = el("label", t(key)),
    input = el(kind);
  Object.assign(input, options);
  label.append(input);
  return [label, input];
}
function formIn(body, fields, submitKey, run) {
  const form = el("form"),
    error = el("p", null, "error"),
    submit = el("button", t(submitKey), "button primary");
  submit.type = "submit";
  error.hidden = true;
  error.setAttribute("role", "alert");
  form.append(...fields, error, submit);
  body.append(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      await run();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}
function account() {
  if (data.access === "editor") {
    const body = startDialog("Редактор");
    body.append(
      action(
        "Проверить заявки",
        () => {
          dialog.close();
          visit("#review");
        },
        true,
      ),
      action("Выйти", async (event) => {
        event.currentTarget.disabled = true;
        try {
          await api("/api/logout", {});
          data.access = "guest";
          requestsVersion++;
          $("requests").replaceChildren();
          $("review-status").textContent = "";
          dialog.close();
          if (section === "review") history.replaceState(null, "", "#tree");
          await load({ preserve: true });
        } catch (err) {
          body.append(el("p", err.message, "error"));
        }
      }),
    );
    return;
  }
  const body = startDialog("Вход редактора");
  const [label, code] = field("Пароль редактора", "input", {
    type: "password",
    required: true,
    autocomplete: "current-password",
    maxLength: 512,
  });
  formIn(body, [label], "Войти", async () => {
    await api("/api/login", { code: code.value.trim() });
    code.value = "";
    dialog.close();
    if (!currentId || section !== "tree") history.replaceState(null, "", "#review");
    await load({ preserve: true });
  });
  code.focus();
}
function proposal(parent) {
  const body = startDialog("Добавить сына");
  const line = el(
    "p",
    t("Отец") + " · " + parent.name,
    "muted",
  );
  const [nameLabel, name] = field("Имя сына", "input", {
    required: true,
    maxLength: 120,
    autocomplete: "off",
  });
  const [noteLabel, note] = field("Комментарий для редактора", "textarea", {
    maxLength: 1000,
    placeholder: t("Необязательно"),
  });
  formIn(
    body,
    [
      line,
      nameLabel,
      noteLabel,
      el("p", t("После подтверждения имя появится в общем древе."), "muted"),
    ],
    "Отправить на проверку",
    async () => {
      if (!name.value.trim()) throw Error(t("Проверьте имя сына"));
      const result = await api("/api/proposals", {
        parent: parent.id,
        name: name.value.trim(),
        note: note.value.trim(),
      });
      if (!dialog.open || !body.contains(name)) return;
      const done = startDialog(
        result.status === "approved"
          ? "Запись подтверждена"
          : "Заявка отправлена",
      );
      done.append(action("Готово", () => dialog.close(), true));
      done.querySelector("button").focus();
    },
  );
  name.focus();
}
function editName(person) {
  const editor = data.access === "editor";
  const body = startDialog("Исправить имя");
  const path = ancestors(person).map(p => p.name).join(" › ");
  const [label, input] = field("Имя", "input", {
    value: person.name, required: true, maxLength: 120, autocomplete: "off",
  });
  const fields = [el("p", path, "muted lineage-context"), label];
  if (!editor) fields.push(el("p", t("После подтверждения имя появится в общем древе."), "muted"));
  formIn(body, fields, editor ? "Сохранить" : "Отправить на проверку", async () => {
    let result;
    try {
      result = await api("/api/name-changes", {
        person: person.id, before: person.name, revision: person.nameRevision || 0,
        name: input.value, publish: editor,
      });
    } catch (error) {
      if (error.status === 409) await load({ preserve: true });
      throw error;
    }
    if (result.status === "approved") await load({ preserve: true });
    if (!dialog.open || !body.contains(input)) return;
    const done = startDialog(result.status === "approved" ? "Имя исправлено" : "Заявка отправлена");
    done.append(action("Готово", () => dialog.close(), true));
    done.querySelector("button").focus();
  });
  input.focus();
  input.select();
}
async function loadReview() {
  const version = ++requestsVersion,
    list = $("requests"),
    status = $("review-status");
  list.replaceChildren();
  status.textContent = t("Загрузка…");
  try {
    const { items } = await api("/api/proposals");
    if (version !== requestsVersion || data.access !== "editor") return;
    const pending = items.filter((p) => p.status === "pending");
    status.textContent = pending.length
      ? t("На проверке") + " · " + pending.length
      : t("Заявок пока нет");
    for (const item of pending) {
      const row = el("article", null, "request"),
        p = data.byId.get(item.person || item.parent);
      row.append(
        el("h2", item.person ? item.before + " → " + item.name : item.name),
        el(
          "small",
          t(item.person ? "Исправить имя" : "Отец") +
            " · " +
            (p
              ? ancestors(p)
                  .map((v) => v.name)
                  .join(" › ")
              : "—"),
        ),
      );
      if (item.note) row.append(el("p", item.note));
      const buttons = el("div", null, "actions");
      async function decide(decision) {
        for (const b of buttons.children) b.disabled = true;
        try {
          await api("/api/proposals/" + encodeURIComponent(item.id), {
            decision,
          });
          $("announcement").textContent = t(
            decision === "approve" ? "Запись подтверждена" : "Заявка отклонена",
          );
          await load({ preserve: true });
        } catch (err) {
          row.append(el("p", err.message, "error"));
          for (const b of buttons.children) b.disabled = false;
        }
      }
      buttons.append(
        action("Подтвердить", () => decide("approve"), true),
        action("Отклонить", () => decide("reject")),
      );
      row.append(buttons);
      list.append(row);
    }
  } catch (err) {
    if (version === requestsVersion) status.textContent = err.message;
  }
}
function setLanguageMenu(open) {
  $("language-menu").hidden = !open;
  $("language").setAttribute("aria-expanded", String(open));
  if (open) languageOptions.find(option => option.lang === lang).focus();
}
$("language").addEventListener("click", () => setLanguageMenu($("language-menu").hidden));
$("language-picker").addEventListener("keydown", (event) => {
  if ($("language-menu").hidden) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setLanguageMenu(true);
    }
    return;
  }
  const index = languageOptions.indexOf(document.activeElement);
  const last = languageOptions.length - 1;
  const next = {
    ArrowDown: (index + 1) % languageOptions.length,
    ArrowUp: (index - 1 + languageOptions.length) % languageOptions.length,
    Home: 0,
    End: last,
  }[event.key];
  if (next !== undefined) {
    event.preventDefault();
    languageOptions[next].focus();
  } else if (event.key === "Escape") {
    event.stopPropagation();
    setLanguageMenu(false);
    $("language").focus();
  } else if (event.key === "Tab") {
    setLanguageMenu(false);
    $("language").focus();
  }
});
$("language-picker").addEventListener("focusout", (event) => {
  if (!$("language-picker").contains(event.relatedTarget)) setLanguageMenu(false);
});
$("language-menu").addEventListener("click", (event) => {
  const option = event.target.closest("button");
  if (!option) return;
  setLanguageMenu(false);
  $("language").focus();
  if (option.lang === lang) return;
  lang = option.lang;
  try {
    localStorage.setItem("khutiev-language", lang);
  } catch {}
  localize();
  if (!data.root) return;
  updateChrome();
  renderHistory();
  renderStats();
  route({ preserve: true });
});
$("account").addEventListener("click", account);
$("export-tree").addEventListener("click", () => {
  const body = startDialog("Сохранить древо");
  const count = el("p", [$("map-count").textContent, $("generation-count").textContent].join(" / "), "muted");
  const choices = el("div", null, "export-choices");
  const status = el("p", "", "muted");
  status.setAttribute("role", "status");
  status.hidden = true;
  for (const format of ["PDF", "PNG"]) {
    choices.append(action(format, async () => {
      for (const choice of choices.children) choice.disabled = true;
      status.hidden = false;
      status.textContent = t("Подготовка файла…");
      try {
        await FamilyTreeExport.download(map, t("Родословная Хутиевых"), format);
        if (body.contains(choices) && dialog.open) dialog.close();
      } catch {
        status.textContent = t("Не удалось сохранить файл. Попробуйте ещё раз.");
      } finally {
        for (const choice of choices.children) choice.disabled = false;
      }
    }));
  }
  body.append(count, choices, status);
  choices.firstChild.focus();
});
function preparePrintTree() {
  const panel = $("print-tree");
  if (!map?.root || section !== "tree") return panel.replaceChildren();
  panel.replaceChildren(FamilyTreeExport.svg(map, t("Родословная Хутиевых")));
}
window.addEventListener("beforeprint", preparePrintTree);
window.addEventListener("afterprint", () => $("print-tree").replaceChildren());
$("edit-name").addEventListener("click", () => {
  const person = data.byId.get(currentId);
  if (person) editName(person);
});
$("add").addEventListener("click", () => {
  const p = data.byId.get(currentId);
  if (p) proposal(p);
});
$("close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (
    e.clientX < rect.left ||
    e.clientX > rect.right ||
    e.clientY < rect.top ||
    e.clientY > rect.bottom
  )
    dialog.close();
});
$("close-person").addEventListener("click", dismissPerson);
$("zoom-in").addEventListener("click", () => map?.zoomBy(1.6));
$("large-text").addEventListener("click", () => {
  const enabled = $("large-text").getAttribute("aria-pressed") !== "true";
  setLargeText(enabled);
  try { localStorage.setItem("khutiev-large-text", String(enabled)); } catch {}
});
try { setLargeText(localStorage.getItem("khutiev-large-text") === "true"); } catch {}
$("zoom-out").addEventListener("click", () => map?.zoomBy(1 / 1.6));
$("fit").addEventListener("click", () => visit("#tree"));
$("refresh").addEventListener("click", loadReview);
$("retry").addEventListener("click", () => load().catch(() => {}));
$("search-input").addEventListener("input", () => {
  searchLimit = 25;
  search();
});
$("clear-query").addEventListener("click", () => {
  clearSearch();
  $("search-input").focus();
});
$("more").addEventListener("click", () => {
  const before = searchLimit;
  searchLimit += 25;
  search();
  $("results").children[before]?.focus();
});
$("search-wrap").addEventListener("keydown", (e) => {
  const results = [...$("results").children];
  const index = results.indexOf(document.activeElement);
  if (e.key === "Escape") {
    clearSearch();
    $("search-input").focus();
    e.stopPropagation();
  }
  if ($("search-pane").hidden) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    results[Math.min(index + 1, results.length - 1)]?.focus();
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    (index <= 0 ? $("search-input") : results[index - 1]).focus();
  }
  if (e.key === "Enter" && e.target === $("search-input")) {
    e.preventDefault();
    results[0]?.click();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!$("language-menu").hidden && !$("language-picker").contains(e.target)) setLanguageMenu(false);
  if (!$("search-wrap").contains(e.target) && !$("search-pane").hidden)
    clearSearch();
});
document.addEventListener("keydown", (e) => {
  if (
    dialog.open ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)
  )
    return;
  if (e.key === "/" && section === "tree") {
    e.preventDefault();
    $("search-input").focus();
  }
  if (e.key === "Escape" && currentId) dismissPerson();
});
document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (
    a?.hash &&
    a.origin === location.origin &&
    a.hash === location.hash &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !e.altKey
  ) {
    e.preventDefault();
    route();
  }
});
window.addEventListener("hashchange", () => route());
load().catch(() => {});
