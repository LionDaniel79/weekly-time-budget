import { cacheModuleGraph } from './src/service-worker-cache.js';

const SHELL_CACHE = 'weekly-time-budget-shell-v14';
const RUNTIME_CACHE = 'weekly-time-budget-runtime-v1';
const APP_CACHE_PREFIX = 'weekly-time-budget-';
const FIREBASE_VERSION_ROOT = 'https://www.gstatic.com/firebasejs/11.10.0/';

const SHELL_URLS = [
  './',
  './index.html',
  './styles.css',
  './src/mobile-compact.css',
  './src/statistics-primary.css',
  './manifest.webmanifest',
  './firebase-config.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/category-effective-date.js',
  './src/goal-domain.js',
  './src/domain.js',
  './src/manual-entry.js',
  './src/app.js',
  './src/auth-login-guard.js',
  './src/category-ui-patch.js',
  './src/category-selection-memory.js',
  './src/category-bulk-editor.js',
  './src/category-delete-guard.js',
  './src/orphan-local-timer-cleanup.js',
  './src/local-timer-removal-reload.js',
  './src/countdown-timer-domain.js',
  './src/time-budget-domain.js',
  './src/time-budget-ui.js',
  './src/time-budget-feature.js',
  './src/recorded-period-domain.js',
  './src/recorded-period-navigation.js',
  './src/statistics-offline-rescue.js',
  './src/statistics-mobile-overflow.js',
  './src/persistent-timer.js',
  './src/persistent-timer-ui.js',
  './src/offline-entry-domain.js',
  './src/offline-store.js',
  './src/offline-entry-repository.js',
  './src/offline-sync.js',
  './src/offline-runtime.js',
  './src/app-toast.js',
  './src/ui-session-state.js',
  './src/service-worker-cache.js',
  './src/service-worker-registration.js',
];

const FIREBASE_ROOTS = [
  `${FIREBASE_VERSION_ROOT}firebase-app.js`,
  `${FIREBASE_VERSION_ROOT}firebase-auth.js`,
  `${FIREBASE_VERSION_ROOT}firebase-firestore.js`,
];

function isSensitiveApi(url) {
  return [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'accounts.google.com',
  ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

function isCacheableModule(url) {
  return url.href.startsWith(FIREBASE_VERSION_ROOT);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('./index.html', response.clone());
    }
    return response;
  } catch {
    return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_URLS);
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled([
      cacheModuleGraph({
        roots: FIREBASE_ROOTS,
        cache: runtime,
        fetchFn: fetch,
        allowed: (url) => String(url).startsWith(FIREBASE_VERSION_ROOT),
      }),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(APP_CACHE_PREFIX) && ![SHELL_CACHE, RUNTIME_CACHE].includes(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isSensitiveApi(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }
  if (isCacheableModule(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});
