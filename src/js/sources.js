// Источники для инструментов «Топ товаров»: сообщества и аккаунты ВКонтакте.
// list: 'sadovod' — сообщества/продавцы Садовода (инструмент 1), 'accounts' — ваши аккаунты (инструмент 2).
// Используются только методы, доступные с обычным ключом пользователя (право wall не нужно):
// utils.resolveScreenName, users.get, groups.getById, groups.search.
import { idb } from './database.js';
import { createStore } from './store.js';
import { callApi } from './vk-api.js';
import { splitInput } from './link-parser.js';

export const sourcesStore = createStore({ loaded: false, items: [] });

export const LISTS = Object.freeze({ SADOVOD: 'sadovod', ACCOUNTS: 'accounts' });

export async function loadSources() {
  const items = (await idb.getAll('sources')).sort((a, b) => a.addedAt - b.addedAt);
  sourcesStore.set({ loaded: true, items });
  return items;
}

export const sourcesOf = (list) => sourcesStore.get().items.filter((s) => s.list === list);
const sourceId = (list, ownerId) => `${list}:${ownerId}`;

/**
 * Разбор ввода: ссылки vk.com/…, id123, club123, public123, event123, @name, name, -123.
 * @returns {{ok: true, kind: 'id'|'screen', ownerId?: number, screenName?: string, input: string} | {ok: false, input: string, reason: string}}
 */
export function parseSourceToken(token) {
  const input = token;
  let raw = String(token || '')
    .trim()
    .replace(/^[<("'«]+|[>)"'».,;]+$/gu, '');
  if (!raw) return { ok: false, input, reason: 'Пустое значение' };
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    return n === 0 ? { ok: false, input, reason: 'Некорректный ID' } : { ok: true, kind: 'id', ownerId: n, input };
  }
  raw = raw.replace(/^@/, '');
  if (/[/.]/.test(raw)) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    } catch {
      return { ok: false, input, reason: 'Не похоже на ссылку' };
    }
    if (!/^(?:m\.|www\.)?(?:vk\.com|vk\.ru|vkontakte\.ru)$/i.test(url.hostname)) return { ok: false, input, reason: 'Ссылка не ведёт на ВКонтакте' };
    raw = url.pathname.split('/').filter(Boolean)[0] || '';
    if (!raw) return { ok: false, input, reason: 'В ссылке нет адреса страницы' };
    const wall = /^wall(-?\d+)_\d+$/i.exec(raw);
    if (wall) return { ok: true, kind: 'id', ownerId: Number(wall[1]), input };
  }
  const m = /^(id|club|public|event)(\d+)$/i.exec(raw);
  if (m) {
    const n = Number(m[2]);
    return { ok: true, kind: 'id', ownerId: m[1].toLowerCase() === 'id' ? n : -n, input };
  }
  if (/^[a-z0-9_.]{2,64}$/i.test(raw)) return { ok: true, kind: 'screen', screenName: raw.toLowerCase(), input };
  return { ok: false, input, reason: 'Не удалось распознать адрес страницы' };
}

function groupToSource(g, list) {
  return {
    id: sourceId(list, -g.id),
    list,
    ownerId: -g.id,
    type: 'group',
    name: g.name,
    screenName: g.screen_name || `club${g.id}`,
    url: `https://vk.com/${g.screen_name || 'club' + g.id}`,
    photo: g.photo_100 || null,
    members: g.members_count ?? null,
    closed: g.is_closed ?? 0,
    selected: true,
    addedAt: Date.now(),
  };
}

function userToSource(u, list) {
  return {
    id: sourceId(list, u.id),
    list,
    ownerId: u.id,
    type: 'user',
    name: `${u.first_name} ${u.last_name}`.trim(),
    screenName: u.screen_name || `id${u.id}`,
    url: `https://vk.com/${u.screen_name || 'id' + u.id}`,
    photo: u.photo_100 || null,
    members: u.followers_count ?? null,
    closed: u.is_closed ? 1 : 0,
    selected: true,
    addedAt: Date.now(),
  };
}

/** Получить данные страниц по ownerId (пачками). */
export async function fetchOwners(ownerIds, list, api = callApi) {
  const users = ownerIds.filter((x) => x > 0);
  const groups = ownerIds.filter((x) => x < 0).map((x) => -x);
  const out = [];
  for (let i = 0; i < users.length; i += 500) {
    const resp = await api('users.get', { user_ids: users.slice(i, i + 500).join(','), fields: 'photo_100,screen_name,followers_count' });
    for (const u of resp || []) if (!u.deactivated) out.push(userToSource(u, list));
  }
  for (let i = 0; i < groups.length; i += 500) {
    const resp = await api('groups.getById', { group_ids: groups.slice(i, i + 500).join(','), fields: 'members_count' });
    const arr = Array.isArray(resp) ? resp : resp?.groups || [];
    for (const g of arr) if (!g.deactivated) out.push(groupToSource(g, list));
  }
  return out;
}

/**
 * Добавить источники из текста (любое количество через пробел/запятую/новую строку).
 * @returns {Promise<{added: object[], failed: Array<{input: string, reason: string}>, existing: number}>}
 */
export async function addSourcesFromText(text, list, api = callApi) {
  const failed = [];
  const ids = new Set();
  for (const token of splitInput(text)) {
    const p = parseSourceToken(token);
    if (!p.ok) {
      failed.push({ input: p.input, reason: p.reason });
      continue;
    }
    if (p.kind === 'id') {
      ids.add(p.ownerId);
      continue;
    }
    try {
      const r = await api('utils.resolveScreenName', { screen_name: p.screenName });
      if (!r || Array.isArray(r) || !r.object_id) failed.push({ input: p.input, reason: 'Страница не найдена' });
      else if (r.type === 'user') ids.add(r.object_id);
      else if (r.type === 'group' || r.type === 'page' || r.type === 'event') ids.add(-r.object_id);
      else failed.push({ input: p.input, reason: 'Это не пользователь и не сообщество' });
    } catch (e) {
      failed.push({ input: p.input, reason: e.message });
    }
  }
  const sources = ids.size ? await fetchOwners([...ids], list, api) : [];
  return saveSources(sources, list, failed);
}

export async function saveSources(sources, list, failed = []) {
  const existingIds = new Set(sourcesOf(list).map((s) => s.id));
  const added = sources.filter((s) => !existingIds.has(s.id));
  if (added.length) await idb.putMany('sources', added);
  sourcesStore.set((st) => ({ ...st, items: [...st.items, ...added] }));
  return { added, failed, existing: sources.length - added.length };
}

/** Поиск сообществ ВКонтакте (groups.search). Возвращает только открытые сообщества, по убыванию подписчиков. */
export async function searchGroups(query, { count = 200, api = callApi } = {}) {
  const resp = await api('groups.search', { q: query, count, fields: 'members_count' });
  const items = (resp?.items || []).filter((g) => g.is_closed === 0 && !g.deactivated);
  return items.map((g) => groupToSource(g, LISTS.SADOVOD)).sort((a, b) => (b.members || 0) - (a.members || 0));
}

export async function updateSource(id, patch) {
  const cur = sourcesStore.get().items.find((s) => s.id === id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  await idb.put('sources', next);
  sourcesStore.set((st) => ({ ...st, items: st.items.map((s) => (s.id === id ? next : s)) }));
}

export async function setAllSelected(list, selected) {
  const changed = sourcesOf(list).map((s) => ({ ...s, selected }));
  await idb.putMany('sources', changed);
  sourcesStore.set((st) => ({ ...st, items: st.items.map((s) => (s.list === list ? { ...s, selected } : s)) }));
}

export async function removeSource(id) {
  await idb.delete('sources', id);
  sourcesStore.set((st) => ({ ...st, items: st.items.filter((s) => s.id !== id) }));
}

export async function clearSources(list) {
  const ids = sourcesOf(list).map((s) => s.id);
  await idb.deleteMany('sources', ids);
  sourcesStore.set((st) => ({ ...st, items: st.items.filter((s) => s.list !== list) }));
}
