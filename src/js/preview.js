// Общий предпросмотр: чистая функция от текущего состояния публикаций и настроек.
// Вызывается при каждом изменении текста/времени/Checkbox — поэтому предпросмотр всегда актуален.
import { finalText } from './author-links.js';
import { effectiveStatus, formatDateTime, STATUS_LABELS } from './scheduler.js';

export function buildPreview(posts, settings) {
  return posts.map((post, index) => {
    const scheduled = Boolean(post.schedule?.at);
    const status = effectiveStatus(post);
    return {
      id: post.id,
      number: index + 1,
      text: finalText(post, settings),
      authorName: post.authorName,
      authorUrl: post.authorUrl,
      authorLinkShown: Boolean(settings?.authorLinksEnabled && post.authorUrl),
      photos: (post.attachments || []).filter((a) => a.preview),
      attachments: post.attachments || [],
      mode: scheduled ? 'scheduled' : 'now',
      modeLabel: scheduled ? `Отложенная: ${formatDateTime(post.schedule.at)}` : 'Сразу после подтверждения',
      scheduledAt: post.schedule?.at || null,
      status,
      statusLabel: STATUS_LABELS[status],
      selected: post.selected !== false,
      resultUrl: post.result?.url || null,
    };
  });
}
