// Запуск приложения: порядок важен.
// 1) обработка возврата из VK ID (до роутера — в адресе code/state или #access_token)
// 2) загрузка локальных данных из IndexedDB (работает офлайн)
// 3) регистрация Service Worker (только в production-сборке)
import { loadSettings } from './settings.js';
import { initPosts } from './post-editor.js';
import { loadHistory } from './history.js';
import { initAuth, handleRedirect, checkConnection, authStore } from './vk-auth.js';
import { initRouter } from './router.js';
import { toast } from './ui-state.js';

export async function bootstrap() {
  await loadSettings();
  await initAuth();
  const redirect = await handleRedirect();
  initRouter();
  await Promise.all([initPosts(), loadHistory()]);
  if (redirect) toast(redirect.message, redirect.ok ? 'success' : 'error', 6000);
  else if (authStore.get().status === 'connected' && navigator.onLine) checkConnection().catch(() => {});
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const register = () =>
    navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch((e) => console.warn('[iTools] SW registration failed', e));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

export function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 300);
}
