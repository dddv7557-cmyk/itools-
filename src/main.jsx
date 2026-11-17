import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { bootstrap, hideSplash } from './js/app.js';
import './css/style.css';
import './css/mobile.css';

const root = createRoot(document.getElementById('root'));

bootstrap()
  .catch((e) => {
    console.error('[iTools] bootstrap failed', e);
    const el = document.getElementById('root');
    el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'fatal';
    box.textContent = `Не удалось открыть локальное хранилище: ${e.message}. Проверьте, что Chrome не в режиме инкогнито с запретом хранения данных.`;
    el.appendChild(box);
    throw e;
  })
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .finally(hideSplash);
