// VK ID: PKCE-запрос, обмен кода, зашифрованное хранение токена, обновление токена.
// Сеть подменяется (fetch / location) — реальные запросы к id.vk.ru в тестах не выполняются.
import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB, idb } from '../src/js/database.js';
import { loadSettings, updateSettings } from '../src/js/settings.js';
import { startLogin, handleRedirect, initAuth, getAccessToken, authStore, pkceChallenge, hasWallScope, logout } from '../src/js/vk-auth.js';

let assigned;
function setLocation(href) {
  const url = new URL(href);
  globalThis.location = { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash, assign: (u) => (assigned = u) };
}

beforeEach(async () => {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  globalThis.history = { replaceState: vi.fn() };
  assigned = null;
  setLocation('https://user.github.io/itools/');
  await loadSettings();
  await updateSettings({ vkAppId: '54000000', authMode: 'vkid' });
  await initAuth();
});

describe('VK ID (OAuth 2.1 + PKCE)', () => {
  it('PKCE S256 — эталонный пример RFC 7636', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('startLogin: корректный адрес authorize без секретов', async () => {
    await startLogin();
    const url = new URL(assigned);
    expect(url.origin + url.pathname).toBe('https://id.vk.ru/authorize');
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('54000000');
    expect(q.get('redirect_uri')).toBe('https://user.github.io/itools/');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state').length).toBeGreaterThanOrEqual(32);
    expect(q.get('scope')).toBe('vkid.personal_info'); // по умолчанию — только базовый доступ
    expect(url.href).not.toMatch(/secret|code_verifier/);
  });

  it('расширенные доступы запрашиваются только по настройке', async () => {
    await updateSettings({ requestExtendedScopes: true });
    await startLogin();
    expect(new URL(assigned).searchParams.get('scope')).toBe('vkid.personal_info wall photos video');
  });

  it('handleRedirect: обмен кода, токен хранится зашифрованным, state проверяется', async () => {
    await startLogin();
    const state = new URL(assigned).searchParams.get('state');
    const fetchMock = vi.fn(async (url, init) => {
      const body = new URLSearchParams(init.body);
      expect(url).toBe('https://id.vk.ru/oauth2/auth');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{64}$/);
      expect(body.get('device_id')).toBe('dev-1');
      return { ok: true, status: 200, json: async () => ({ access_token: 'AT-SECRET', refresh_token: 'RT', expires_in: 3600, user_id: 777, state, scope: 'vkid.personal_info wall photos' }) };
    });
    globalThis.fetch = fetchMock;
    setLocation(`https://user.github.io/itools/?code=CODE&state=${state}&device_id=dev-1`);
    const r = await handleRedirect();
    expect(r.ok).toBe(true);
    expect(authStore.get().status).toBe('connected');
    expect(await getAccessToken()).toBe('AT-SECRET');
    expect(hasWallScope()).toBe(true);
    // в хранилище нет открытого токена
    const raw = await idb.get('kv', 'secret:vk-session');
    expect(raw.data).toBeInstanceOf(ArrayBuffer);
    expect(JSON.stringify([...new Uint8Array(raw.data)])).not.toContain('AT-SECRET');
  });

  it('подменённый state отклоняется', async () => {
    await startLogin();
    globalThis.fetch = vi.fn();
    setLocation('https://user.github.io/itools/?code=CODE&state=WRONG_STATE_WRONG_STATE_WRONG_1234&device_id=d');
    const r = await handleRedirect();
    expect(r.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('истёкший access token обновляется через refresh token', async () => {
    await startLogin();
    const state = new URL(assigned).searchParams.get('state');
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'OLD', refresh_token: 'RT1', expires_in: 1, user_id: 1, state, scope: 'wall' }) }));
    setLocation(`https://user.github.io/itools/?code=C&state=${state}&device_id=d`);
    await handleRedirect();
    await new Promise((r) => setTimeout(r, 30)); // фоновая проверка подключения после входа
    globalThis.fetch = vi.fn(async (_u, init) => {
      expect(new URLSearchParams(init.body).get('grant_type')).toBe('refresh_token');
      return { ok: true, status: 200, json: async () => ({ access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600 }) };
    });
    expect(await getAccessToken()).toBe('NEW');
    await logout();
    expect(authStore.get().status).toBe('disconnected');
    expect(await getAccessToken()).toBeNull();
  });
});
