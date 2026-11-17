import { useDeferredValue, useMemo, useState } from 'react';
import { useStore } from '../hooks.js';
import { historyStore, filterHistory, clearHistory, deleteHistoryItem, HISTORY_KINDS } from '../js/history.js';
import { formatDateTime } from '../js/scheduler.js';
import { confirmDialog } from '../js/dialogs.js';
import { toast } from '../js/ui-state.js';
import VirtualList from '../components/VirtualList.jsx';
import Icon from '../components/Icon.jsx';

const FILTERS = [
  ['all', 'Все'],
  ['published', 'Опубликованные'],
  ['scheduled', 'Запланированные'],
  ['draft', 'Черновики'],
  ['error', 'Ошибки'],
];
const TONES = { published: 'green', scheduled: 'violet', draft: 'neutral', error: 'red' };

function HistoryItem({ item }) {
  return (
    <article className="card history-item">
      <header className="post-head">
        <span className={`pill pill-${TONES[item.kind]}`}>{HISTORY_KINDS[item.kind]}</span>
        <time className="muted small" dateTime={new Date(item.at).toISOString()}>
          {formatDateTime(item.at)}
        </time>
        <button className="icon-btn icon-btn-sm ml-auto" aria-label="Удалить запись истории" onClick={() => deleteHistoryItem(item.id)}>
          <Icon name="x" size={16} />
        </button>
      </header>
      {item.text ? <p className="history-text">{item.text}</p> : null}
      {item.error ? <p className="text-danger small">{item.error}</p> : null}
      <div className="history-meta">
        {item.scheduledAt ? (
          <span className="chip">
            <Icon name="clock" size={13} /> {formatDateTime(item.scheduledAt)}
          </span>
        ) : null}
        {item.authorName ? <span className="chip">Автор: {item.authorName}</span> : null}
        {item.url ? (
          <a className="chip chip-green" href={item.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={13} /> Запись во ВКонтакте
          </a>
        ) : null}
        {item.sourceUrl ? (
          <a className="chip" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={13} /> Источник
          </a>
        ) : null}
      </div>
    </article>
  );
}

export default function HistoryPage() {
  const { items, loaded } = useStore(historyStore);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => filterHistory(items, { query: deferredQuery, kind }), [items, deferredQuery, kind]);
  const byId = useMemo(() => new Map(filtered.map((h) => [String(h.id), h])), [filtered]);
  const ids = useMemo(() => filtered.map((h) => String(h.id)), [filtered]);
  const counts = useMemo(() => {
    const c = { all: items.length };
    for (const h of items) c[h.kind] = (c[h.kind] || 0) + 1;
    return c;
  }, [items]);

  return (
    <div className="page history">
      <div className="search-box">
        <Icon name="search" size={18} />
        <input
          type="search"
          className="input"
          placeholder="Поиск по тексту, автору, ссылке"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по истории"
        />
      </div>
      <div className="filter-chips" role="tablist" aria-label="Фильтр истории">
        {FILTERS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={kind === key} className={`chip chip-btn ${kind === key ? 'active' : ''}`} onClick={() => setKind(key)}>
            {label} <span className="count">{counts[key] || 0}</span>
          </button>
        ))}
      </div>
      {!loaded ? (
        <div className="page-loading">
          <span className="spinner" />
        </div>
      ) : filtered.length ? (
        <VirtualList ids={ids} estimateSize={170} renderItem={(id) => <HistoryItem item={byId.get(id)} />} gap={10} />
      ) : (
        <div className="empty">
          <Icon name="history" size={40} stroke={1.5} />
          <p>{items.length ? 'Ничего не найдено' : 'Здесь появятся опубликованные и запланированные записи, черновики и ошибки.'}</p>
        </div>
      )}
      {items.length ? (
        <button
          className="btn btn-ghost btn-block text-danger mt"
          onClick={async () => {
            if (await confirmDialog({ title: 'Очистить историю?', body: 'Журнал операций будет удалён с устройства.', confirmText: 'Очистить', danger: true })) {
              await clearHistory();
              toast('История очищена');
            }
          }}
        >
          <Icon name="trash" size={16} /> Очистить историю
        </button>
      ) : null}
    </div>
  );
}
