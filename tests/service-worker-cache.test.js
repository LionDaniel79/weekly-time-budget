import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheModuleGraph, extractModuleSpecifiers } from '../src/service-worker-cache.js';

test('정적 import를 절대 URL로 중복 없이 추출한다', () => {
  const source = `
    import './a.js';
    import { value } from './b.js';
    export { other } from './c.js';
    import './a.js';
    const lazy = import('./lazy.js');
  `;
  assert.deepEqual(extractModuleSpecifiers(source, 'https://cdn.example/root.js'), [
    'https://cdn.example/a.js',
    'https://cdn.example/b.js',
    'https://cdn.example/c.js',
    'https://cdn.example/lazy.js',
  ]);
});

test('순환 ESM 그래프를 한 번씩 캐시한다', async () => {
  const sources = new Map([
    ['https://cdn.example/root.js', `import './a.js'; import './b.js';`],
    ['https://cdn.example/a.js', `import './b.js';`],
    ['https://cdn.example/b.js', `import './a.js'; export const b = 1;`],
  ]);
  const cached = [];
  await cacheModuleGraph({
    roots: ['https://cdn.example/root.js'],
    allowed: (url) => url.startsWith('https://cdn.example/'),
    fetchFn: async (url) => new Response(sources.get(String(url)), { status: 200, headers: { 'content-type': 'text/javascript' } }),
    cache: { put: async (url) => cached.push(String(url)) },
  });
  assert.deepEqual(new Set(cached), new Set(sources.keys()));
});
