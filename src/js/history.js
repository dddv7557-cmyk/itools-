// История операций (хранится в IndexedDB, доступна офлайн).
import { idb } from './database.js';
import { createStore } from './store.js';

export const HISTORY_KINDS = Object.freeze({
  published: 'Опубликована',
  scheduled: 'Запланирована',
  draft: 'Черновик',
  error: 'Ошибка',
});

export const historyStore = createStore({ loaded: false, items: [] });

export async function loadHistory() {
  const items = (await idb.getAll('history')).sort((a, b) => b.at - a.at);
  historyStore.set({ loaded: true, items });
  return items;
}

/**
 * @param {{kind: 'published'|'scheduled'|'draft'|'error', postId: string, sourceUrl?: string,
 *          authorName?: string, text?: string, url?: string, scheduledAt?: number, error?: string}} entry
 */
export async function addHistory(entry) {
  const record = {
    ...entry,
    text: String(entry.text || '').slice(0, 2000),
    at: entry.at || Date.now(),
  };
  const id = await idb.put('history', record);
  const saved = { ...record, id };
  historyStore.set((s) => ({ ...s, items: [saved, ...s.items] }));
  return saved;
}

/** Черновик в истории: обновляем существующую запись для этой публикации, чтобы не плодить дубликаты. */
export async function upsertDraftHistory(entry) {
  const existing = historyStore.get().items.find((h) => h.kind === 'draft' && h.postId === entry.postId);
  if (!existing) return addHistory({ ...entry, kind: 'draft' });
  const record = { ...existing, ...entry, kind: 'draft', text: String(entry.text || '').slice(0, 2000), at: Date.now() };
  await idb.put('history', record);
  historyStore.set((s) => ({ ...s, items: [record, ...s.items.filter((h) => h.id !== record.id)] }));
  return record;
}

export function filterHistory(items, { query = '', kind = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return items.filter((h) => {
    if (kind !== 'all' && h.kind !== kind) return false;
    if (!q) return true;
    return [h.text, h.authorName, h.sourceUrl, h.url, h.error].some((v) => String(v || '').toLowerCase().includes(q));
  });
}

export async function deleteHistoryItem(id) {
  await idb.delete('history', id);
  historyStore.set((s) => ({ ...s, items: s.items.filter((h) => h.id !== id) }));
}

export async function clearHistory() {
  await idb.clear('history');
  historyStore.set({ loaded: true, items: [] });
}
