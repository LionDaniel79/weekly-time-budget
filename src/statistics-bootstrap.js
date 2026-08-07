import { firebaseConfig } from '../firebase-config.js';
import { getExistingOfflineRuntime } from './offline-runtime.js';
import { createStatisticsDataSource } from './statistics-data-source.js';
import { createStatisticsFeature } from './statistics-feature.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const firestore = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = firestore.getFirestore(app);
const root = document.querySelector('#statistics-view');

if (root) {
  const diagnostics = {
    modeChanges: 0,
    aggregateRuns: 0,
    renderRuns: 0,
    stateSaves: 0,
    aggregateDurations: [],
  };
  window.__weeklyTimeBudgetDiagnostics = window.__weeklyTimeBudgetDiagnostics || {};
  window.__weeklyTimeBudgetDiagnostics.statistics = diagnostics;

  const dataSource = createStatisticsDataSource({
    firestore,
    db,
    runtimeForUser: getExistingOfflineRuntime,
  });
  const feature = createStatisticsFeature({
    root,
    dataSource,
    getCurrentUser: () => auth.currentUser,
    saveUiState: async (partial) => {
      document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', {
        detail: partial,
      }));
    },
    setHeader: ({ title, label }) => {
      const pageTitle = document.querySelector('#page-title');
      const weekLabel = document.querySelector('#week-label');
      if (pageTitle) pageTitle.textContent = title;
      if (weekLabel) weekLabel.textContent = label;
    },
    diagnostics,
  });

  const statisticsVisible = () => !root.classList.contains('hidden');
  let currentView = 'dashboard';
  let refreshQueued = false;

  document.addEventListener('weekly-time-budget:view-changed', (event) => {
    const nextView = event.detail?.view || 'dashboard';
    if (nextView === currentView) return;
    currentView = nextView;
    if (nextView === 'statistics') feature.enter();
    else feature.leave();
  });

  document.addEventListener('weekly-time-budget:ui-state-restored', (event) => {
    feature.restore(event.detail?.statistics || {});
  });

  document.addEventListener('weekly-time-budget:data-changed', () => {
    if (!statisticsVisible() || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(async () => {
      refreshQueued = false;
      if (statisticsVisible()) await feature.refresh();
    });
  });

  authModule.onAuthStateChanged(auth, (user) => {
    if (user) return;
    currentView = 'dashboard';
    feature.leave();
    root.innerHTML = '';
  });
}
