import { useMemo } from 'react';
import { useStore } from '../hooks.js';
import { postsStore } from '../js/post-editor.js';
import { historyStore } from '../js/history.js';
import { authStore } from '../js/vk-auth.js';
import { effectiveStatus } from '../js/scheduler.js';
import { navigate } from '../js/router.js';
import { onlineStore, installStore, promptInstall, toast } from '../js/ui-state.js';
import { Avatar } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';

export default function HomePage() {
  const { order, byId } = useStore(postsStore);
  const history = useStore(historyStore);
  const auth = useStore(authStore);
  const online = useStore(onlineStore);
  const install = useStore(installStore);

  const stats = useMemo(() => {
    const s = { total: order.length, waiting: 0, scheduled: 0, published: 0, problems: 0 };
    for (const id of order) {
      const st = effectiveStatus(byId[id]);
      if (st === 'waiting') s.waiting++;
      else if (st === 'scheduled_vk') s.scheduled++;
      else if (st === 'published') s.published++;
      else if (st === 'error' || st === 'action_required') s.problems++;
    }
    return s;
  }, [order, byId]);

  return (
    <div className="page home">
      <section className="hero card">
        <div className="hero-text">
          <span className="hero-kicker">VK Smart Publisher</span>
          <h1>Публикуйте пачками — аккуратно и по расписанию</h1>
          <p className="muted">Вставьте ссылки, отредактируйте тексты, назначьте время и отправьте в свой аккаунт ВКонтакте.</p>
        </div>
        <button className="btn btn-primary btn-block btn-lg" onClick={() => navigate('/publisher')}>
          <Icon name="send" size={18} /> Открыть VK Publisher
        </button>
      </section>

      <section className="stats-grid" aria-label="Статистика рабочей области">
        <button className="stat-card" onClick={() => navigate('/publisher')}>
          <b>{stats.total}</b>
          <span>в работе</span>
        </button>
        <button className="stat-card" onClick={() => navigate('/publisher')}>
          <b className="text-warn">{stats.waiting}</b>
          <span>со временем</span>
        </button>
        <button className="stat-card" onClick={() => navigate('/history')}>
          <b className="text-violet">{stats.scheduled}</b>
          <span>в расписании VK</span>
        </button>
        <button className="stat-card" onClick={() => navigate('/history')}>
          <b className="text-success">{stats.published}</b>
          <span>опубликовано</span>
        </button>
      </section>

      {stats.problems ? (
        <button className="notice notice-warn notice-btn" onClick={() => navigate('/publisher')}>
          <Icon name="alert" size={18} /> {stats.problems} публикаций требуют внимания
        </button>
      ) : null}

      <section className="card account-mini" onClick={() => navigate('/account')} role="button" tabIndex={0}>
        {auth.status === 'connected' && auth.profile ? (
          <>
            <Avatar src={auth.profile.photo} name={auth.profile.name} size={44} />
            <div className="grow">
              <b>{auth.profile.name}</b>
              <span className="muted small">Аккаунт ВКонтакте подключён</span>
            </div>
            <span className="dot dot-green" />
          </>
        ) : (
          <>
            <span className="avatar avatar-fallback" style={{ width: 44, height: 44 }}>
              <Icon name="user" />
            </span>
            <div className="grow">
              <b>{auth.status === 'expired' ? 'Требуется повторный вход' : 'Аккаунт не подключён'}</b>
              <span className="muted small">Подключите ВКонтакте через VK ID — без пароля</span>
            </div>
            <Icon name="external" size={18} />
          </>
        )}
      </section>

      <section className="card info-list">
        <div className="info-row">
          <Icon name={online ? 'wifi' : 'wifiOff'} />
          <div>
            <b>{online ? 'Онлайн' : 'Офлайн'}</b>
            <span className="muted small">
              {online ? 'Загрузка и публикация доступны' : 'Редактирование, предпросмотр, черновики и история работают без интернета'}
            </span>
          </div>
        </div>
        <div className="info-row">
          <Icon name="shield" />
          <div>
            <b>Данные на устройстве</b>
            <span className="muted small">Публикации, время и история хранятся локально в IndexedDB</span>
          </div>
        </div>
        <div className="info-row">
          <Icon name="history" />
          <div>
            <b>Операций в истории: {history.items.length}</b>
            <span className="muted small">Поиск и фильтры — в разделе «История»</span>
          </div>
        </div>
      </section>

      {!install.installed ? (
        <section className="card install-card">
          <Icon name="phone" size={28} />
          <div className="grow">
            <b>Установите iTools на главный экран</b>
            <span className="muted small">
              {install.canInstall ? 'Работает как обычное приложение, в том числе офлайн.' : 'Chrome → меню ⋮ → «Добавить на главный экран».'}
            </span>
          </div>
          {install.canInstall ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                if (await promptInstall()) toast('iTools установлен', 'success');
              }}
            >
              Установить
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
