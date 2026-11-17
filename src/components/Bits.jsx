import { STATUS_LABELS } from '../js/scheduler.js';
import Icon from './Icon.jsx';

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'blue',
  waiting: 'amber',
  scheduled_vk: 'violet',
  publishing: 'blue',
  published: 'green',
  error: 'red',
  action_required: 'amber',
};

export function StatusPill({ status }) {
  return (
    <span className={`pill pill-${STATUS_TONE[status] || 'neutral'}`}>
      {status === 'publishing' ? <span className="spinner spinner-xs" aria-hidden="true" /> : null}
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function fmtDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** Фото, видео и прочие вложения (горизонтальная лента). */
export function Attachments({ attachments = [], unsupported = [], large = false }) {
  if (!attachments.length && !unsupported.length) return null;
  const media = attachments.filter((a) => a.preview);
  const other = attachments.filter((a) => !a.preview);
  return (
    <div className="attachments">
      {media.length ? (
        <div className={`media-strip ${large ? 'media-strip-large' : ''} ${media.length === 1 ? 'single' : ''}`}>
          {media.map((a, i) => (
            <figure key={a.vkId || i} className={`media media-${a.type}`}>
              <img src={a.preview} alt={a.label} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              {a.type === 'video' ? (
                <span className="media-badge">
                  <Icon name="play" size={12} /> {fmtDuration(a.duration)}
                </span>
              ) : null}
              {a.type === 'link' || a.type === 'doc' || a.type === 'album' ? <figcaption>{a.label}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : null}
      {other.length || unsupported.length ? (
        <div className="chips">
          {other.map((a, i) => (
            <span key={a.vkId || i} className="chip">
              <Icon name={a.type === 'link' ? 'link' : 'file'} size={14} /> {a.label}
            </span>
          ))}
          {unsupported.map((a, i) => (
            <span key={`u${i}`} className="chip chip-muted" title="Это вложение нельзя прикрепить через API">
              <Icon name="alert" size={14} /> {a.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Progress({ value, total, label }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-label={label}>
      <div className="progress-top">
        <span>{label}</span>
        <span>
          {value} / {total}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, id }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description ? <span className="toggle-desc">{description}</span> : null}
      </span>
    </label>
  );
}

export function Avatar({ src, name, size = 36 }) {
  const initials = String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return src ? (
    <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials}
    </span>
  );
}
