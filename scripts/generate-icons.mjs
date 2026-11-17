// Генерирует PNG-иконки приложения без внешних зависимостей (zlib + ручной PNG-кодер).
// Логотип: синий градиент, белая буква «i» и «T» (iTools). Запуск: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(outDir, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance функции в нормализованных координатах [0..1]
const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function render(size, { maskable = false, rounded = true } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const s = maskable ? 0.72 : 1; // безопасная зона для maskable-иконок
  const aa = 1.2 / size;
  const top = [59, 130, 246];
  const bottom = [29, 78, 216];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;
      // фон
      const bgD = maskable || !rounded ? -1 : sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, 0.22);
      const bgA = Math.min(1, Math.max(0, 0.5 - bgD / aa));
      const t = py;
      let r = top[0] + (bottom[0] - top[0]) * t;
      let g = top[1] + (bottom[1] - top[1]) * t;
      let b = top[2] + (bottom[2] - top[2]) * t;
      // логотип в локальных координатах
      const lx = (px - 0.5) / s + 0.5;
      const ly = (py - 0.5) / s + 0.5;
      const dI = Math.min(sdCircle(lx, ly, 0.33, 0.3, 0.065), sdRoundRect(lx, ly, 0.33, 0.6, 0.055, 0.17, 0.05));
      const dT = Math.min(
        sdRoundRect(lx, ly, 0.6, 0.31, 0.17, 0.055, 0.05),
        sdRoundRect(lx, ly, 0.6, 0.55, 0.055, 0.22, 0.05),
      );
      const d = Math.min(dI, dT);
      const fg = Math.min(1, Math.max(0, 0.5 - d / (aa / s)));
      r = r * (1 - fg) + 255 * fg;
      g = g * (1 - fg) + 255 * fg;
      b = b * (1 - fg) + 255 * fg;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(255 * bgA);
    }
  }
  return encodePNG(size, buf);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { rounded: false }],
  ['favicon-32.png', 32, {}],
];
for (const [name, size, opts] of targets) {
  writeFileSync(resolve(outDir, name), render(size, opts));
  console.log('icon:', name);
}
