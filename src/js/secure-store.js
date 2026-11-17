// Хранение токенов: AES-GCM шифрование неизвлекаемым ключом WebCrypto.
// Ключ (CryptoKey с extractable=false) лежит в IndexedDB, токены — только в зашифрованном виде.
// В LocalStorage токены не попадают никогда.
// Честное ограничение: код, выполняющийся на этом же сайте, может расшифровать токен —
// поэтому в приложении нет сторонних скриптов, а CSP-настройку хостинга см. README.
import { idb } from './database.js';

const KEY_ID = 'cryptoKey';

async function getKey() {
  let key = await idb.get('kv', KEY_ID);
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb.put('kv', key, KEY_ID);
  }
  return key;
}

export async function saveSecret(name, value) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  await idb.put('kv', { iv, data }, `secret:${name}`);
}

export async function loadSecret(name) {
  const rec = await idb.get('kv', `secret:${name}`);
  if (!rec) return null;
  try {
    const key = await getKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

export async function deleteSecret(name) {
  await idb.delete('kv', `secret:${name}`);
}
