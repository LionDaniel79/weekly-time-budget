import { cacheModuleGraph } from './src/service-worker-cache.js';

const SHELL_CACHE = 'weekly-time-budget-shell-v16';
const RUNTIME_CACHE = 'weekly-time-budget-firebase-v2';
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
  './src/app-data-source.js',
  './src/app-session-state.js',
  './src/view-change-events.js',
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
  './src/record-feature.js',
  './src/history-feature.js',
  './src/app-shell.js',
  './src/auth-feature.js',
  './src/category-feature.js',
  './src/recorded-period-domain.js',
  './src/statistics-state.js',
  './src/statistics-data-source.js',
  './src/statistics-view.js',
  './src/statistics-feature.js',
  './src/statistics-bootstrap.js',
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

function isFirebaseModule(url) {
  return url.href.startsWith(FIREBASE_VERSION_ROOT);
}

async function firebaseCacheFirst(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await runtime.put(request, response.clone());
  return response;
}

async function shellCacheFirst(request) {
  const shell = await caches.open(SHELL_CACHE);
  const cached = await shell.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await shell.put(request, response.clone());
  return response;
}

async function navigationResponse(request) {
  const shell = await caches.open(SHELL_CACHE);
  const cached = (await shell.match(request))
    || (await shell.match('./index.html'))
    || (await shell.match('./'));
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await shell.put('./index.html', response.clone());
    return response;
  } catch {
    return Response.error();
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
  if (isFirebaseModule(url)) {
    event.respondWith(firebaseCacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(shellCacheFirst(request));
  }
});
