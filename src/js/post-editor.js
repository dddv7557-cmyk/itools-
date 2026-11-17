// Рабочая область: независимые редакторы публикаций.
// Каждая публикация — отдельная запись в IndexedDB; изменение одной не затрагивает другие.
// Правки текста сохраняются автоматически (отложенно ~350 мс, а также при сворачивании приложения).
import { idb } from './database.js';
import { createStore } from './store.js';
import { STATUS, FINAL_STATUSES, makeSchedule } from './scheduler.js';

export const postsStore = createStore({ loaded: false, order: [], byId: {} });

const SAVE_DELAY = 350;
const pendingSaves = new Map(); // id -> timeout
let lastSaveError = null;

function sortRecords(records) {
  return [...records].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function initPosts() {
  const records = sortRecords(await idb.getAll('posts'));
  const byId = {};
  for (const r of records) {
    // Если приложение было закрыто во время отправки — результат неизвестен, его нужно проверить.
    if (r.status === STATUS.PUBLISHING) r.needsVerify = true;
    byId[r.id] = r;
  }
  postsStore.set({ loaded: true, order: records.map((r) => r.id), byId });
  return records;
}

export const getPost = (id) => postsStore.get().byId[id];
export const getAllPosts = () => {
  const { order, byId } = postsStore.get();
  return order.map((id) => byId[id]).filter(Boolean);
};

function persistLater(id) {
  clearTimeout(pendingSaves.get(id));
  pendingSaves.set(
    id,
    setTimeout(() => persistNow(id), SAVE_DELAY),
  );
}

async function persistNow(id) {
  clearTimeout(pendingSaves.get(id));
  pendingSaves.delete(id);
  const post = getPost(id);
  if (!post) return;
  try {
    await idb.put('posts', post);
    lastSaveError = null;
  } catch (e) {
    lastSaveError = e;
    console.error('[iTools] save failed', e);
  }
}

export async function flushPending() {
  const ids = [...pendingSaves.keys()];
  await Promise.all(ids.map((id) => persistNow(id)));
}

export const getLastSaveError = () => lastSaveError;

/** Изменить одну публикацию. Остальные записи не трогаются (новый объект только для id). */
export function updatePost(id, patch, { immediate = false } = {}) {
  const state = postsStore.get();
  const prev = state.byId[id];
  if (!prev) return null;
  const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch), updatedAt: Date.now() };
  postsStore.set({ ...state, byId: { ...state.byId, [id]: next } });
  if (immediate) return persistNow(id).then(() => next);
  persistLater(id);
  return next;
}

export function setText(id, text) {
  return updatePost(id, (p) => ({
    text,
    edited: text !== p.originalText,
    // правка после ошибки возвращает запись в работу
    status: p.status === STATUS.ERROR ? STATUS.READY : p.status,
  }));
}

export function restoreOriginal(id) {
  return updatePost(id, (p) => ({ text: p.originalText, edited: false }), { immediate: true });
}

export function setPostSchedule(id, ts) {
  return updatePost(
    id,
    (p) => ({
      schedule: makeSchedule(ts),
      localWait: false,
      status: FINAL_STATUSES.has(p.status) || p.status === STATUS.PUBLISHING ? p.status : STATUS.READY,
      error: p.status === STATUS.ACTION || p.status === STATUS.ERROR ? null : p.error,
    }),
    { immediate: true },
  );
}

export function clearPostSchedule(id) {
  return updatePost(
    id,
    (p) => ({
      schedule: null,
      localWait: false,
      status: FINAL_STATUSES.has(p.status) || p.status === STATUS.PUBLISHING ? p.status : STATUS.READY,
      error: p.status === STATUS.ACTION ? null : p.error,
    }),
    { immediate: true },
  );
}

export function setSelected(id, selected) {
  return updatePost(id, { selected: Boolean(selected) });
}

export function selectAll(selected) {
  const state = postsStore.get();
  const byId = { ...state.byId };
  for (const id of state.order) byId[id] = { ...byId[id], selected: Boolean(selected) };
  postsStore.set({ ...state, byId });
  return idb.putMany('posts', Object.values(byId));
}

/** Добавить загруженные публикации в конец списка. Уже существующие (по ключу) пропускаются. */
export async function addPosts(records) {
  const state = postsStore.get();
  let maxOrder = state.order.reduce((m, id) => Math.max(m, state.byId[id]?.order ?? 0), 0);
  const added = [];
  const skipped = [];
  const byId = { ...state.byId };
  const order = [...state.order];
  for (const r of records) {
    if (byId[r.id]) {
      skipped.push(r);
      continue;
    }
    const rec = { ...r, order: ++maxOrder };
    byId[rec.id] = rec;
    order.push(rec.id);
    added.push(rec);
  }
  if (added.length) await idb.putMany('posts', added);
  postsStore.set({ ...state, order, byId });
  return { added, skipped };
}

export async function removePost(id) {
  const state = postsStore.get();
  if (!state.byId[id]) return;
  clearTimeout(pendingSaves.get(id));
  pendingSaves.delete(id);
  const byId = { ...state.byId };
  delete byId[id];
  postsStore.set({ ...state, byId, order: state.order.filter((x) => x !== id) });
  await idb.delete('posts', id);
}

export async function clearWorkspace() {
  for (const t of pendingSaves.values()) clearTimeout(t);
  pendingSaves.clear();
  postsStore.set({ loaded: true, order: [], byId: {} });
  await idb.clear('posts');
}

/** Удалить из рабочей области уже опубликованные/переданные в расписание записи (они остаются в Истории). */
export async function removeFinished() {
  const ids = getAllPosts()
    .filter((p) => FINAL_STATUSES.has(p.status))
    .map((p) => p.id);
  const state = postsStore.get();
  const byId = { ...state.byId };
  for (const id of ids) delete byId[id];
  postsStore.set({ ...state, byId, order: state.order.filter((x) => !ids.includes(x)) });
  await idb.deleteMany('posts', ids);
  return ids.length;
}

export async function replaceAllPosts(records) {
  for (const t of pendingSaves.values()) clearTimeout(t);
  pendingSaves.clear();
  await idb.clear('posts');
  await idb.putMany('posts', records);
  await initPosts();
}

if (typeof window !== 'undefined') {
  const flush = () => {
    flushPending();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
