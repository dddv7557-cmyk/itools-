import { useLayoutEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

/**
 * Виртуализированный список карточек с динамической высотой (окно = страница).
 * В DOM находятся только видимые карточки + запас, поэтому 100+ публикаций не тормозят.
 */
export default function VirtualList({ ids, renderItem, estimateSize = 520, overscan = 3, gap = 14 }) {
  const listRef = useRef(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const update = () => setMargin(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0);
    update();
    const ro = new ResizeObserver(update);
    if (listRef.current?.parentElement) ro.observe(listRef.current.parentElement);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: ids.length,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin: margin,
    gap,
    getItemKey: (index) => ids[index],
  });

  const items = virtualizer.getVirtualItems();
  return (
    <div ref={listRef} className="vlist" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {items.map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className="vlist-item"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - margin}px)` }}
        >
          {renderItem(ids[item.index], item.index)}
        </div>
      ))}
    </div>
  );
}
