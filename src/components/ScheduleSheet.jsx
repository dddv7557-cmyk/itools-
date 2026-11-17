import { useMemo, useState } from 'react';
import { Sheet } from './Overlays.jsx';
import Icon from './Icon.jsx';
import {
  deviceTimeZone,
  formatDateTime,
  fromLocalParts,
  toLocalParts,
  validateSchedule,
  MIN_LEAD_MS,
} from '../js/scheduler.js';
import { setPostSchedule, clearPostSchedule } from '../js/post-editor.js';
import { toast } from '../js/ui-state.js';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function defaultTs() {
  // ближайшее «круглое» время через час
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return d.getTime();
}

/** Индивидуальное время одной публикации. Изменения затрагивают только эту запись. */
export default function ScheduleSheet({ post, number, onClose }) {
  const initial = toLocalParts(post.schedule?.at || defaultTs());
  const [date, setDate] = useState(initial.date);
  const [hours, setHours] = useState(initial.hours);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [touched, setTouched] = useState(false);
  const tz = deviceTimeZone();
  const minDate = toLocalParts(Date.now() + MIN_LEAD_MS).date;

  const ts = fromLocalParts(date, hours, minutes);
  const validation = useMemo(() => (ts == null ? { ok: false, error: 'Такого времени не существует (перевод часов?)' } : validateSchedule(ts)), [ts]);

  const applyPreset = (target) => {
    const p = toLocalParts(target);
    setDate(p.date);
    setHours(p.hours);
    setMinutes(p.minutes);
    setTouched(true);
  };
  const tomorrowAt = (h) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };

  const save = async () => {
    setTouched(true);
    if (!validation.ok) return;
    await setPostSchedule(post.id, ts);
    toast(`Публикация №${number}: время ${formatDateTime(ts)}`, 'success');
    onClose();
  };
  const cancelTime = async () => {
    await clearPostSchedule(post.id);
    toast(`Публикация №${number}: время снято — отправится сразу`, 'info');
    onClose();
  };

  return (
    <Sheet
      title={`Время публикации №${number}`}
      onClose={onClose}
      footer={
        <div className="btn-col">
          <button className="btn btn-primary btn-block" onClick={save} disabled={touched && !validation.ok}>
            <Icon name="check" size={18} /> {post.schedule?.at ? 'Сохранить новое время' : 'Сохранить время'}
          </button>
          {post.schedule?.at ? (
            <button className="btn btn-danger-ghost btn-block" onClick={cancelTime}>
              <Icon name="x" size={18} /> Отменить время (опубликовать сразу)
            </button>
          ) : null}
        </div>
      }
    >
      <p className="tz-note">
        <Icon name="clock" size={16} /> Часовой пояс устройства: <b>{tz.name}</b> ({tz.offset})
      </p>
      <div className="presets">
        <button className="chip chip-btn" onClick={() => applyPreset(Date.now() + 60 * 60 * 1000)}>
          Через час
        </button>
        <button className="chip chip-btn" onClick={() => applyPreset(Date.now() + 3 * 60 * 60 * 1000)}>
          Через 3 часа
        </button>
        <button className="chip chip-btn" onClick={() => applyPreset(tomorrowAt(10))}>
          Завтра 10:00
        </button>
        <button className="chip chip-btn" onClick={() => applyPreset(tomorrowAt(19))}>
          Завтра 19:00
        </button>
      </div>
      <div className="schedule-grid">
        <label className="field">
          <span>Дата</span>
          <input
            type="date"
            className="input"
            value={date}
            min={minDate}
            onChange={(e) => {
              setDate(e.target.value);
              setTouched(true);
            }}
          />
        </label>
        <label className="field">
          <span>Часы</span>
          <select
            className="input"
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              setTouched(true);
            }}
          >
            {HOURS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Минуты</span>
          <select
            className="input"
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setTouched(true);
            }}
          >
            {MINUTES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      {touched && !validation.ok ? (
        <p className="form-error" role="alert">
          <Icon name="alert" size={16} /> {validation.error}
        </p>
      ) : ts ? (
        <p className="muted small">
          Запись будет передана в отложенные записи ВКонтакте и опубликована {formatDateTime(ts)} серверами ВКонтакте — телефон и
          приложение для этого не нужны.
        </p>
      ) : null}
    </Sheet>
  );
}
