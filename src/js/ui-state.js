// Состояние интерфейса: уведомления, сеть, установка PWA.
import { createStore } from './store.js';

// --- Toasts ---
export const toastStore = createStore([]);
let toastId = 0;
export function toast(message, type = 'info', timeout = 3500) {
  const id = ++toastId;
  toastStore.set((list) => [...list.slice(-2), { id, message, type }]);
  if (timeout) setTimeout(() => dismissToast(id), timeout);
  return id;
}
export const dismissToast = (id) => toastStore.set((list) => list.filter((t) => t.id !== id));

// --- Online status ---
export const onlineStore = createStore(typeof navigator === 'undefined' ? true : navigator.onLine);
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => onlineStore.set(true));
  window.addEventListener('offline', () => onlineStore.set(false));
}

// --- Install prompt (Android Chrome) ---
export const installStore = createStore({ canInstall: false, installed: false });
let deferredPrompt = null;
if (typeof window !== 'undefined') {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  installStore.set({ canInstall: false, installed: Boolean(standalone) });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installStore.set((s) => ({ ...s, canInstall: true }));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installStore.set({ canInstall: false, installed: true });
  });
}
export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  installStore.set((s) => ({ ...s, canInstall: false }));
  return choice?.outcome === 'accepted';
}
