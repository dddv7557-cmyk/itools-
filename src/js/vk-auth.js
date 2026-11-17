// Подключение аккаунта ВКонтакте без пароля и без секретных ключей в JavaScript.
//
// Режим 'vkid' (основной): VK ID, OAuth 2.1 Authorization Code + PKCE для ПУБЛИЧНОГО приложения.
//   GET  https://id.vk.ru/authorize            → ?code&state&device_id на redirect_uri
//   POST https://id.vk.ru/oauth2/auth          grant_type=authorization_code | refresh_token
//   POST https://id.vk.ru/oauth2/logout
//   Access token живёт 1 час и обновляется через Refresh token.
//
// Режим 'classic': oauth.vk.com Implicit Flow (для старых Standalone-приложений, если он ещё
//   доступен вашему приложению). Токен приходит в #hash адреса.
//
// Токены хранятся только в зашифрованном виде (secure-store.js), не в LocalStorage.
import { idb } from './database.js';
import { createStore } from './store.js';
import { saveSecret, loadSecret, deleteSecret } from './secure-store.js';
import { callApi, setTokenProvider, setAuthErrorHandler, API_VERSION } from './vk-api.js';
import { getSettings } from './settings.js';

export const VKID_HOST = 'https://id.vk.ru';
export const VKID_SCOPES = 'vkid.personal_info wall photos video';
export const CLASSIC_SCOPES = 'wall,photos,video,offline';
const PENDING_KEY = 'auth:pending';
const SESSION_NAME = 'vk-session';
const PENDING_TTL = 10 * 60 * 1000;

export const authStore = createStore({
  status: 'unknown', // unknown | disconnected | connected | expired
  profile: null,
  session: null, // метаданные без токенов: { mode, userId, scope, expiresAt, connectedAt }
  checking: false,
  lastCheck: null,
  error: null,
});

let session = null; // полная сессия с токенами — только в памяти и в зашифрованном хранилище
let refreshing = null;

// --- утилиты PKCE -------------------------------------------------------------
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export function randomString(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 63];
  return out;
}
function base64url(buffer) {
  let s = '';
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function pkceChallenge(verifier) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export function redirectUri() {
  return location.origin + location.pathname;
}

function publicMeta(s) {
  if (!s) return null;
  return { mode: s.mode, userId: s.userId, scope: s.scope, expiresAt: s.expiresAt, connectedAt: s.connectedAt };
}

async function storeSession(next) {
  session = next;
  await saveSecret(SESSION_NAME, next);
  authStore.set((st) => ({ ...st, session: publicMeta(next), profile: next.profile || st.profile }));
}

// --- вход ---------------------------------------------------------------------
export async function startLogin() {
  const { vkAppId, authMode } = getSettings();
  const appId = String(vkAppId || '').trim();
  if (!/^\d+$/.test(appId)) throw new Error('Укажите ID приложения ВКонтакте в разделе «Настройки» (см. инструкцию README).');
  if (!navigator.onLine) throw new Error('Для подключения аккаунта нужен интернет.');
  const state = randomString(43);
  const redirect = redirectUri();

  if (authMode === 'classic') {
    await idb.put('kv', { state, mode: 'classic', redirect, appId, at: Date.now() }, PENDING_KEY);
    const url = new URL('https://oauth.vk.com/authorize');
    url.search = new URLSearchParams({
      client_id: appId,
      display: 'mobile',
      redirect_uri: redirect,
      scope: CLASSIC_SCOPES,
      response_type: 'token',
      v: API_VERSION,
      state,
    }).toString();
    location.assign(url.toString());
    return;
  }

  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  // PKCE-верификатор живёт ≤10 минут и нужен только для обмена кода; хранится в IndexedDB,
  // потому что после возврата из приложения VK Android может открыть новую вкладку.
  await idb.put('kv', { state, verifier, mode: 'vkid', redirect, appId, at: Date.now() }, PENDING_KEY);
  const url = new URL(`${VKID_HOST}/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: appId,
    redirect_uri: redirect,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: VKID_SCOPES,
    lang_id: '0',
    scheme: 'light',
  }).toString();
  location.assign(url.toString());
}

async function postForm(path, params) {
  const res = await fetch(`${VKID_HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* пустой ответ */
  }
  if (!res.ok || !data || data.error) {
    const msg = data?.error_description || data?.error || `HTTP ${res.status}`;
    const err = new Error(`VK ID: ${msg}`);
    err.vkidError = data?.error;
    throw err;
  }
  return data;
}

function cleanUrl(hashRoute = '#/account') {
  history.replaceState(null, '', location.pathname + hashRoute);
}

/**
 * Обрабатывает возврат со страницы авторизации. Вызывается до запуска роутера.
 * @returns {Promise<null | {ok: boolean, message: string}>}
 */
export async function handleRedirect() {
  const url = new URL(location.href);
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  const hashParams = new URLSearchParams(hash.startsWith('/') ? '' : hash);
  const isClassic = hashParams.has('access_token') || (hashParams.has('error') && hashParams.has('state'));
  let q = url.searchParams;
  if (q.has('payload')) {
    try {
      const p = JSON.parse(q.get('payload'));
      q = new URLSearchParams({ code: p.code, state: p.state, device_id: p.device_id });
    } catch {
      /* ignore */
    }
  }
  const isVkid = q.has('code') && q.has('state');
  const isVkidError = q.has('error') && (q.has('state') || q.has('error_description'));
  if (!isClassic && !isVkid && !isVkidError) return null;

  const pending = await idb.get('kv', PENDING_KEY);
  await idb.delete('kv', PENDING_KEY);
  try {
    if (isVkidError || hashParams.has('error')) {
      const desc = q.get('error_description') || hashParams.get('error_description') || q.get('error') || hashParams.get('error');
      throw new Error(`Авторизация отменена или отклонена: ${desc}`);
    }
    const state = isClassic ? hashParams.get('state') : q.get('state');
    if (!pending || pending.state !== state) throw new Error('Ответ авторизации не прошёл проверку (state). Попробуйте ещё раз.');
    if (Date.now() - pending.at > PENDING_TTL) throw new Error('Время ожидания авторизации истекло. Попробуйте ещё раз.');

    if (isClassic) {
      const expiresIn = Number(hashParams.get('expires_in') || 0);
      await storeSession({
        mode: 'classic',
        appId: pending.appId,
        accessToken: hashParams.get('access_token'),
        userId: Number(hashParams.get('user_id')),
        scope: CLASSIC_SCOPES,
        expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
        connectedAt: Date.now(),
      });
    } else {
      const deviceId = q.get('device_id');
      const data = await postForm('/oauth2/auth', {
        grant_type: 'authorization_code',
        code_verifier: pending.verifier,
        redirect_uri: pending.redirect,
        code: q.get('code'),
        client_id: pending.appId,
        device_id: deviceId,
        state: pending.state,
      });
      if (data.state && data.state !== pending.state) throw new Error('Ответ VK ID не прошёл проверку (state).');
      await storeSession({
        mode: 'vkid',
        appId: pending.appId,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        deviceId,
        userId: Number(data.user_id),
        scope: data.scope || '',
        expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
        connectedAt: Date.now(),
      });
    }
    authStore.set((s) => ({ ...s, status: 'connected', error: null }));
    cleanUrl();
    checkConnection().catch(() => {});
    return { ok: true, message: 'Аккаунт ВКонтакте подключён' };
  } catch (e) {
    cleanUrl();
    authStore.set((s) => ({ ...s, error: e.message }));
    return { ok: false, message: e.message };
  }
}

async function refreshTokens() {
  if (!session?.refreshToken) throw new Error('Нет refresh token');
  const state = randomString(43);
  const data = await postForm('/oauth2/auth', {
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    client_id: session.appId,
    device_id: session.deviceId,
    state,
  });
  await storeSession({
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    scope: data.scope || session.scope,
  });
}

/** Токен для VK API. Для VK ID автоматически обновляется за минуту до истечения. */
export async function getAccessToken() {
  if (!session) return null;
  const soon = session.expiresAt && session.expiresAt - 60 * 1000 < Date.now();
  if (soon) {
    if (session.mode === 'vkid' && session.refreshToken) {
      if (!navigator.onLine) return session.accessToken;
      refreshing ||= refreshTokens().finally(() => {
        refreshing = null;
      });
      try {
        await refreshing;
      } catch (e) {
        authStore.set((s) => ({ ...s, status: 'expired', error: `Не удалось обновить токен: ${e.message}` }));
        return null;
      }
    } else if (session.expiresAt < Date.now()) {
      authStore.set((s) => ({ ...s, status: 'expired' }));
      return null;
    }
  }
  return session.accessToken;
}

/** Проверка подключения: users.get текущего пользователя. */
export async function checkConnection() {
  if (!session) {
    authStore.set((s) => ({ ...s, status: 'disconnected' }));
    return null;
  }
  authStore.set((s) => ({ ...s, checking: true }));
  try {
    const users = await callApi('users.get', { fields: 'photo_100,photo_200,screen_name' });
    const u = users?.[0];
    if (!u) throw new Error('ВКонтакте не вернул данные профиля');
    const profile = {
      id: u.id,
      name: `${u.first_name} ${u.last_name}`.trim(),
      photo: u.photo_200 || u.photo_100,
      url: `https://vk.com/${u.screen_name || 'id' + u.id}`,
    };
    await storeSession({ ...session, userId: u.id, profile });
    authStore.set((s) => ({ ...s, status: 'connected', profile, checking: false, lastCheck: Date.now(), error: null }));
    return profile;
  } catch (e) {
    authStore.set((s) => ({
      ...s,
      checking: false,
      lastCheck: Date.now(),
      status: e.code === 5 ? 'expired' : s.status,
      error: e.message,
    }));
    throw e;
  }
}

export function hasWallScope() {
  const scope = session?.scope || '';
  return /(^|[\s,])wall($|[\s,])/.test(scope);
}

export function currentUserId() {
  return session?.userId || null;
}

export async function logout() {
  const s = session;
  session = null;
  await deleteSecret(SESSION_NAME);
  authStore.set({ status: 'disconnected', profile: null, session: null, checking: false, lastCheck: null, error: null });
  if (s?.mode === 'vkid' && navigator.onLine) {
    try {
      await postForm('/oauth2/logout', { client_id: s.appId, access_token: s.accessToken });
    } catch {
      /* токен уже удалён локально; ошибка выхода на стороне VK не критична */
    }
  }
}

export async function initAuth() {
  setTokenProvider(getAccessToken);
  setAuthErrorHandler(() => authStore.set((s) => ({ ...s, status: 'expired' })));
  session = await loadSecret(SESSION_NAME);
  if (!session) {
    authStore.set((s) => ({ ...s, status: 'disconnected' }));
    return;
  }
  const expired = session.mode === 'classic' && session.expiresAt && session.expiresAt < Date.now();
  authStore.set((s) => ({
    ...s,
    status: expired ? 'expired' : 'connected',
    profile: session.profile || null,
    session: publicMeta(session),
  }));
}
