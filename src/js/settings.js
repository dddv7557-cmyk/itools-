// Настройки пользователя. Источник истины — IndexedDB (kv/settings).
// Несекретное зеркало в LocalStorage нужно только для мгновенной отрисовки при старте.
import { idb } from './database.js';
import { createStore } from './store.js';
import { DEFAULT_TEMPLATE } from './author-links.js';

const LS_KEY = 'itools.ui';

export const DEFAULT_SETTINGS = Object.freeze({
  authorLinksEnabled: false,
  authorLinkTemplate: DEFAULT_TEMPLATE,
  vkAppId: '',
  authMode: 'vkid', // 'vkid' (VK ID, OAuth 2.1 + PKCE) | 'classic' (oauth.vk.com, Implicit Flow)
  // Запрашивать расширенные доступы wall/photos/video. Включайте, только если VK их выдал вашему приложению:
  // запрошенный список не может быть шире разрешённого в настройках приложения VK ID.
  requestExtendedScopes: false,
  // 'manual' — публикация через официальное приложение/сайт ВК (право wall не нужно);
  // 'api' — автоматически через wall.post (нужно право wall).
  publishMode: 'manual',
  loadChunkSize: 100,
});

function readMirror() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeMirror(s) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ authorLinksEnabled: s.authorLinksEnabled, authorLinkTemplate: s.authorLinkTemplate }),
    );
  } catch {
    /* LocalStorage может быть недоступен — не критично */
  }
}

export const settingsStore = createStore({ ...DEFAULT_SETTINGS, ...readMirror(), loaded: false });

function envAppId() {
  try {
    return import.meta.env?.VITE_VK_APP_ID || '';
  } catch {
    return '';
  }
}

export async function loadSettings() {
  let stored = null;
  try {
    stored = await idb.get('kv', 'settings');
  } catch (e) {
    console.warn('[iTools] settings load failed', e);
  }
  const merged = { ...DEFAULT_SETTINGS, ...readMirror(), ...stored };
  if (!merged.vkAppId) merged.vkAppId = envAppId();
  settingsStore.set({ ...merged, loaded: true });
  writeMirror(merged);
  return merged;
}

export function getSettings() {
  return settingsStore.get();
}

export async function updateSettings(patch) {
  const next = { ...settingsStore.get(), ...patch };
  settingsStore.set(next);
  writeMirror(next);
  const { loaded: _loaded, ...persist } = next;
  await idb.put('kv', persist, 'settings');
  return next;
}

export function setAuthorLinksEnabled(enabled) {
  return updateSettings({ authorLinksEnabled: Boolean(enabled) });
}
