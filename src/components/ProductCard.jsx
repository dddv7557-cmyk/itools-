import { memo } from 'react';
import { formatDateTime } from '../js/scheduler.js';
import Icon from './Icon.jsx';

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** Карточка товара в рейтинге. */
function ProductCard({ product: p, rank, selected, onToggle, sortKey }) {
  return (
    <article className={`card product-card ${selected ? 'is-selected' : ''}`} aria-label={`Товар №${rank}`}>
      <div className="product-media">
        {p.photos[0] ? <img src={p.photos[0]} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <Icon name="image" size={32} />}
        <span className={`rank ${rank <= 3 ? 'rank-top' : ''}`}>#{rank}</span>
        {p.photos.length > 1 ? <span className="media-count">+{p.photos.length - 1}</span> : null}
      </div>
      <div className="product-body">
        <div className="product-top">
          {p.price ? <b className="price">{p.price.toLocaleString('ru-RU')} ₽</b> : <span className="muted small">цена не указана</span>}
          <label className="select-box" aria-label={`Выбрать товар №${rank}`}>
            <input type="checkbox" checked={selected} onChange={() => onToggle(p.key)} />
          </label>
        </div>
        {p.text ? <p className="product-text">{p.text}</p> : null}
        <div className="metrics">
          <span className={sortKey === 'score' ? 'hl' : ''} title="Общий балл">
            ★ {fmt(Math.round(p.score))}
          </span>
          <span className={sortKey === 'likes' ? 'hl' : ''} title="Лайки">
            ♥ {fmt(p.likes)}
          </span>
          <span className={sortKey === 'reposts' ? 'hl' : ''} title="Репосты">
            ↻ {fmt(p.reposts)}
          </span>
          <span className={sortKey === 'comments' ? 'hl' : ''} title="Комментарии">
            💬 {fmt(p.comments)}
          </span>
          <span className={sortKey === 'views' ? 'hl' : ''} title="Просмотры">
            👁 {fmt(p.views)}
          </span>
          {sortKey === 'er' ? <span className="hl">ER {p.er}%</span> : null}
        </div>
        <div className="product-foot">
          <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="muted small ellipsis">
            {p.sourceName}
          </a>
          <span className="muted small">{formatDateTime(p.date).split(',')[0]}</span>
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="icon-btn icon-btn-sm" aria-label="Открыть запись во ВКонтакте">
            <Icon name="external" size={16} />
          </a>
        </div>
      </div>
    </article>
  );
}

export default memo(ProductCard);
