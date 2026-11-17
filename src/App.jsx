import { useLayoutEffect } from 'react';
import { useStore, useInterval } from './hooks.js';
import { routeStore, navigate } from './js/router.js';
import { onlineStore, toast } from './js/ui-state.js';
import { authStore } from './js/vk-auth.js';
import { publishDueLocal } from './js/publisher.js';
import { askCaptcha } from './js/dialogs.js';
import HomePage from './pages/HomePage.jsx';
import PublisherPage from './pages/PublisherPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import TopPage from './pages/TopPage.jsx';
import { Toasts, Dialogs } from './components/Overlays.jsx';
import { Avatar } from './components/Bits.jsx';
import Icon from './components/Icon.jsx';

const NAV = [
  { path: '/', label: 'Главная', icon: 'home' },
  { path: '/publisher', label: 'VK Publisher', icon: 'send' },
  { path: '/history', label: 'История', icon: 'history' },
  { path: '/settings', label: 'Настройки', icon: 'settings' },
];

const PAGES = {
  '/': HomePage,
  '/publisher': PublisherPage,
  '/history': HistoryPage,
  '/settings': SettingsPage,
  '/account': AccountPage,
  '/top': TopPage,
};

const TITLES = { '/publisher': 'VK Publisher', '/history': 'История', '/settings': 'Настройки', '/account': 'Аккаунт', '/top': 'Топ товаров' };

function Header({ path }) {
  const online = useStore(onlineStore);
  const auth = useStore(authStore);
  return (
    <header className="app-header">
      <button className="brand" onClick={() => navigate('/')} aria-label="iTools — на главную">
        <img src="./icons/icon-192.png" alt="" width="30" height="30" />
        <span className="brand-name">iTools</span>
        {TITLES[path] ? <span className="brand-sub">{TITLES[path]}</span> : null}
      </button>
      <div className="header-right">
        <span className={`net ${online ? 'net-on' : 'net-off'}`} role="status" aria-live="polite">
          <Icon name={online ? 'wifi' : 'wifiOff'} size={14} />
          <span>{online ? 'Онлайн' : 'Офлайн'}</span>
        </span>
        <button className="header-avatar" onClick={() => navigate('/account')} aria-label="Мой аккаунт ВКонтакте">
          <Avatar src={auth.profile?.photo} name={auth.profile?.name || '?'} size={32} />
          <span className={`dot ${auth.status === 'connected' ? 'dot-green' : auth.status === 'expired' ? 'dot-amber' : 'dot-gray'}`} />
        </button>
      </div>
    </header>
  );
}

function BottomNav({ path }) {
  return (
    <nav className="bottom-nav" aria-label="Основное меню">
      {NAV.map((item) => {
        const active = path === item.path || (item.path === '/settings' && path === '/account') || (item.path === '/' && path === '/top');
        return (
          <button key={item.path} className={`nav-item ${active ? 'active' : ''}`} onClick={() => navigate(item.path)} aria-current={active ? 'page' : undefined}>
            <span className="nav-icon">
              <Icon name={item.icon} size={22} stroke={active ? 2.3 : 1.8} />
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const { path } = useStore(routeStore);
  const online = useStore(onlineStore);
  const Page = PAGES[path] || HomePage;
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  // Запасной локальный планировщик: только для записей, которые ВКонтакте не принял в расписание
  // и для которых пользователь явно включил «Ждать в приложении». Работает, лишь пока приложение открыто.
  useInterval(async () => {
    const r = await publishDueLocal({ onCaptcha: askCaptcha }).catch(() => null);
    if (r && (r.published || r.failed || r.action)) toast(`Локальное ожидание: опубликовано ${r.published}, проблем ${r.failed + r.action}`, r.failed + r.action ? 'error' : 'success');
  }, 30000);

  return (
    <div className="app">
      <Header path={path} />
      {!online ? (
        <div className="offline-banner" role="status">
          <Icon name="wifiOff" size={16} /> Нет интернета — редактирование, предпросмотр, черновики и история работают офлайн
        </div>
      ) : null}
      <main className="app-main">
        <Page />
      </main>
      <BottomNav path={path} />
      <Toasts />
      <Dialogs />
    </div>
  );
}
