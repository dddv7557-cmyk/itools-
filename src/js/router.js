// Hash-роутер: работает на любом статическом хостинге (GitHub Pages, Netlify, Cloudflare Pages) без настройки.
import { createStore } from './store.js';

export const ROUTES = ['/', '/publisher', '/history', '/settings', '/account'];

function parse() {
  const raw = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: ROUTES.includes(path) ? path : '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export const routeStore = createStore(parse());

export function navigate(path, params) {
  const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const target = '#' + path + qs;
  if (location.hash !== target) location.hash = target;
  else routeStore.set(parse());
}

export function initRouter() {
  window.addEventListener('hashchange', () => {
    routeStore.set(parse());
  });
  routeStore.set(parse());
}
