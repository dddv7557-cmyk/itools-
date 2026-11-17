// Модальные окна на промисах: confirm(), askCaptcha().
import { createStore } from './store.js';

export const dialogStore = createStore(null);

function open(type, props) {
  return new Promise((resolve) => {
    dialogStore.set({ type, props, resolve });
  });
}

export function closeDialog(value) {
  const d = dialogStore.get();
  dialogStore.set(null);
  d?.resolve(value);
}

/** @returns {Promise<boolean>} */
export const confirmDialog = (props) => open('confirm', props).then(Boolean);

/** @returns {Promise<string|null>} */
export const askCaptcha = (img) => open('captcha', { img });
