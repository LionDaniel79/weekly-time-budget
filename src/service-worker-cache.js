const STATIC_IMPORT_PATTERN = /(?:\bimport\s*(?:[^'"()]*?\sfrom\s*)?|\bexport\s+[^'"()]*?\sfrom\s*|\bimport\s*\()(['"])([^'"]+)\1/g;

export function extractModuleSpecifiers(source = '', baseUrl) {
  const values = [];
  const seen = new Set();
  for (const match of String(source).matchAll(STATIC_IMPORT_PATTERN)) {
    try {
      const absolute = new URL(match[2], baseUrl).href;
      if (!seen.has(absolute)) {
        seen.add(absolute);
        values.push(absolute);
      }
    } catch {
      // Ignore non-URL module identifiers.
    }
  }
  return values;
}

export async function cacheModuleGraph({
  roots = [],
  cache,
  fetchFn = globalThis.fetch,
  allowed = () => true,
} = {}) {
  if (!cache?.put || typeof fetchFn !== 'function') throw new Error('모듈 캐시 설정이 필요합니다.');
  const queue = [...roots].map(String);
  const seen = new Set();

  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url) || !allowed(url)) continue;
    seen.add(url);
    const response = await fetchFn(url);
    if (!response?.ok) throw new Error(`모듈을 캐시하지 못했습니다: ${url}`);
    await cache.put(url, response.clone());
    const source = await response.text();
    for (const dependency of extractModuleSpecifiers(source, url)) {
      if (!seen.has(dependency) && allowed(dependency)) queue.push(dependency);
    }
  }

  return [...seen];
}
