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

  document.addEventListener('weekly-time-budget:view-changed', (event) => {
    if (event.detail?.view === 'statistics') feature.enter();
    else feature.leave();
  });

  document.addEventListener('weekly-time-budget:ui-state-restored', (event) => {
    feature.restore(event.detail?.statistics || {});
    if (event.detail?.activeView === 'statistics') feature.enter();
  });

  document.addEventListener('weekly-time-budget:data-changed', () => {
    if (statisticsVisible()) feature.refresh();
  });

  authModule.onAuthStateChanged(auth, (user) => {
    if (!user) {
      feature.leave();
      root.innerHTML = '';
      return;
    }
    if (statisticsVisible()) feature.enter();
  });
}
