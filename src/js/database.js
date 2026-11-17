// IndexedDB — основное локальное хранилище iTools.
// Хранилища:
//  posts   — публикации рабочей области (оригинал, правки, время, вложения, статус)
//  history — журнал операций (публикации, расписание, черновики, ошибки)
//  kv      — настройки, зашифрованная сессия ВКонтакте, ключ шифрования
export const DB_NAME = 'itools';
export const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступна в этом браузере'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('posts')) {
        const posts = db.createObjectStore('posts', { keyPath: 'id' });
        posts.createIndex('order', 'order');
      }
      if (!db.objectStoreNames.contains('history')) {
        const history = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        history.createIndex('at', 'at');
        history.createIndex('postId', 'postId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => console.warn('[iTools] IndexedDB upgrade blocked by another tab');
  });
  return dbPromise;
}

/** Закрыть соединение (нужно тестам для имитации перезапуска приложения). */
export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

async function run(storeNames, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция IndexedDB прервана'));
    const out = work(tx);
    if (out && typeof out === 'object' && 'onsuccess' in out) {
      out.onsuccess = () => {
        result = out.result;
      };
    } else {
      result = out;
    }
  });
}

export const idb = {
  get: (store, key) => run(store, 'readonly', (tx) => tx.objectStore(store).get(key)),
  getAll: (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll()),
  put: (store, value, key) =>
    run(store, 'readwrite', (tx) => (key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key))),
  putMany: (store, values) =>
    run(store, 'readwrite', (tx) => {
      const os = tx.objectStore(store);
      for (const v of values) os.put(v);
      return values.length;
    }),
  delete: (store, key) => run(store, 'readwrite', (tx) => tx.objectStore(store).delete(key)),
  deleteMany: (store, keys) =>
    run(store, 'readwrite', (tx) => {
      const os = tx.objectStore(store);
      for (const k of keys) os.delete(k);
      return keys.length;
    }),
  clear: (store) => run(store, 'readwrite', (tx) => tx.objectStore(store).clear()),
  count: (store) => run(store, 'readonly', (tx) => tx.objectStore(store).count()),
};

/** Просит браузер не удалять данные при нехватке места (защита от потери данных). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

export async function storageEstimate() {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    return est ? { usage: est.usage || 0, quota: est.quota || 0, persisted } : null;
  } catch {
    return null;
  }
}
