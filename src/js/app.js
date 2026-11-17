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
import { loadSources } from './sources.js';

const LINKS_DRAFT_KEY = 'itools.linksDraft';

/**
 * Web Share Target: «Поделиться» → iTools из любого приложения Android (ВКонтакте, Садовод Агрегатор…).
 * Присланный текст/ссылка дописывается в поле ссылок VK Publisher.
 * @returns {number} сколько символов получено (0 — это не share-запуск)
 */
function handleShareTarget() {
  const url = new URL(location.href);
  // manifest.share_target (GET) присылает ?title=&text=&url= на стартовый адрес
  if (!['title', 'text', 'url'].some((k) => url.searchParams.has(k))) return 0;
  const all = ['title', 'text', 'url'].map((k) => url.searchParams.get(k) || '').join(' ');
  // из присланного текста берём только ссылки (описание товара в поле ссылок не нужно)
  const links = all.match(/https?:\/\/[^\s<>"']+|\bwall-?\d+_\d+\b/giu) || [];
  const shared = (links.length ? [...new Set(links)] : [all.trim()]).filter(Boolean).join('\n');
  try {
    const prev = localStorage.getItem(LINKS_DRAFT_KEY) || '';
    localStorage.setItem(LINKS_DRAFT_KEY, [prev, shared].filter(Boolean).join('\n'));
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', location.pathname + '#/publisher');
  return shared.length;
}

export async function bootstrap() {
  await loadSettings();
  await initAuth();
  const redirect = await handleRedirect();
  const shared = handleShareTarget();
  initRouter();
  await Promise.all([initPosts(), loadHistory(), loadSources()]);
  if (shared) toast('Ссылка получена — она в поле ссылок VK Publisher', 'success');
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
