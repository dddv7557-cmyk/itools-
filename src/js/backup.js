// Экспорт и импорт резервной копии (JSON-файл). Токены ВКонтакте в копию НЕ попадают.
import { idb } from './database.js';
import { flushPending, initPosts } from './post-editor.js';
import { loadHistory } from './history.js';
import { loadSettings } from './settings.js';
import { loadSources } from './sources.js';

export const BACKUP_FORMAT = 'itools-backup';
export const BACKUP_VERSION = 1;

export async function createBackup() {
  await flushPending();
  const [posts, history, settings, sources] = await Promise.all([
    idb.getAll('posts'),
    idb.getAll('history'),
    idb.get('kv', 'settings'),
    idb.getAll('sources'),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: settings || {},
    posts,
    history,
    sources,
  };
}

export async function downloadBackup() {
  const data = await createBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `itools-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { posts: data.posts.length, history: data.history.length };
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Файл не является резервной копией iTools');
  if (data.format !== BACKUP_FORMAT) throw new Error('Неизвестный формат файла');
  if (data.version > BACKUP_VERSION) throw new Error('Копия создана более новой версией iTools');
  if (!Array.isArray(data.posts) || !Array.isArray(data.history)) throw new Error('Повреждённая резервная копия');
  for (const p of data.posts) {
    if (!p || typeof p.id !== 'string' || typeof p.text !== 'string') throw new Error('Повреждённая запись публикации в копии');
  }
  return true;
}

/**
 * @param {object} data — разобранный JSON
 * @param {'merge'|'replace'} mode
 */
export async function restoreBackup(data, mode = 'merge') {
  validateBackup(data);
  await flushPending();
  const { vkAppId: _ignored, ...settings } = data.settings || {};
  if (mode === 'replace') {
    await idb.clear('posts');
    await idb.clear('history');
  }
  const existing = mode === 'merge' ? new Set((await idb.getAll('posts')).map((p) => p.id)) : new Set();
  let order = mode === 'merge' ? (await idb.getAll('posts')).reduce((m, p) => Math.max(m, p.order || 0), 0) : 0;
  const posts = data.posts
    .filter((p) => !existing.has(p.id))
    .map((p) => ({ ...p, order: mode === 'merge' ? ++order : p.order }));
  await idb.putMany('posts', posts);
  const history = data.history.map(({ id: _id, ...h }) => h);
  for (const h of history) await idb.put('history', h);
  if (Array.isArray(data.sources)) {
    if (mode === 'replace') await idb.clear('sources');
    await idb.putMany('sources', data.sources.filter((s) => s && typeof s.id === 'string'));
  }
  const current = (await idb.get('kv', 'settings')) || {};
  await idb.put('kv', { ...current, ...settings, vkAppId: current.vkAppId || '' }, 'settings');
  await Promise.all([initPosts(), loadHistory(), loadSettings(), loadSources()]);
  return { posts: posts.length, history: history.length, skipped: data.posts.length - posts.length };
}

export async function importBackupFile(file, mode) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Не удалось прочитать JSON-файл');
  }
  return restoreBackup(data, mode);
}
