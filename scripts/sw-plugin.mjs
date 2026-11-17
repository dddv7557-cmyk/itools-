// Vite-плагин: при сборке выпускает service-worker.js со списком файлов
// для предварительного кэширования (все JS/CSS бандлы + файлы из public/).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function serviceWorkerPlugin() {
  let root = process.cwd();
  let publicDir = resolve(root, 'public');
  return {
    name: 'itools-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const bundleFiles = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      let publicFiles = [];
      try {
        publicFiles = listFiles(publicDir).map((f) => relative(publicDir, f).split('\\').join('/'));
      } catch {
        publicFiles = [];
      }
      const precache = ['./', ...new Set([...bundleFiles, ...publicFiles])]
        .filter((f) => !/^service-worker\.js$/.test(f))
        .map((f) => (f === './' ? f : './' + f));
      const version = createHash('sha256').update(precache.join('|') + Date.now()).digest('hex').slice(0, 12);
      const template = readFileSync(resolve(root, 'sw/service-worker.js'), 'utf8');
      const source = template
        .replace('self.__ITOOLS_PRECACHE__', JSON.stringify(precache, null, 0))
        .replace('__ITOOLS_VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}
