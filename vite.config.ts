import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import preact from '@preact/preset-vite';

/**
 * 서비스 워커(sw/sw.template.js)에 이 빌드의 앱 파일 목록과 버전을 채워 sw.js로 내보낸다.
 * 버전은 파일 목록(이름에 내용 해시가 들어 있음)에서 만들어서, 코드가 같으면 버전도 같다.
 * 글꼴 파일은 수가 많고 커서 미리 받지 않고, 쓸 때 저장한다.
 */
function serviceWorker(): Plugin {
  return {
    name: 'gagyeboo-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !/\.(woff2?|map)$/.test(f));
      const extra = [
        'index.html',
        'favicon.svg',
        'manifest.webmanifest',
        'about.html',
        'privacy.html',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
      ];
      const list = [...new Set([...extra, ...files])].sort();
      const version = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
      const src = readFileSync('sw/sw.template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(list));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// GitHub Pages 프로젝트 사이트 주소: https://<계정>.github.io/gagyeboo/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/gagyeboo/',
  plugins: [preact(), serviceWorker()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
