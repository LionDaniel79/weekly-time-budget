import { firebaseConfig } from '../firebase-config.js';
import { getOfflineRuntime } from './offline-runtime.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const store = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = store.getFirestore(app);
let user = null;

function timerStorageKey(uid) {
  return `weekly-time-budget:active-timer:${uid}`;
}

function readTimer(uid) {
  try {
    const value = localStorage.getItem(timerStorageKey(uid));
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function cleanupOrphanLocalTimer() {
  if (!user) return;
  const timer = readTimer(user.uid);
  if (!timer?.categoryId) return;
  const runtime = await getOfflineRuntime({ userId: user.uid, firestore: store, db });
  const snapshot = await runtime.store.getSnapshot(user.uid);
  if (!snapshot) return;
  const knownIds = new Set([
    ...(snapshot.categories || []).map((category) => category.id),
    ...(snapshot.archivedCategories || []).map((category) => category.id),
  ]);
  if (knownIds.has(timer.categoryId)) return;
  localStorage.removeItem(timerStorageKey(user.uid));
  document.dispatchEvent(new CustomEvent('weekly-time-budget:local-timer-removed', {
    detail: { userId: user.uid, categoryId: timer.categoryId },
  }));
}

authModule.onAuthStateChanged(auth, (nextUser) => {
  user = nextUser;
  if (user) cleanupOrphanLocalTimer().catch(console.error);
});

document.addEventListener('weekly-time-budget:data-changed', () => {
  cleanupOrphanLocalTimer().catch(console.error);
});
