export async function installFakeFirebaseRoutes(page, fixture) {
  await page.addInitScript((value) => {
    globalThis.__statisticsFixture = value;
  }, fixture);

  await page.route('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const app = {};
      export const getApps = () => [app];
      export const getApp = () => app;
      export const initializeApp = () => app;
    `,
  }));

  await page.route('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const user = { uid: 'browser-user', displayName: 'Browser User' };
      const auth = { currentUser: user };
      export const getAuth = () => auth;
      export const onAuthStateChanged = (_auth, callback) => {
        queueMicrotask(() => callback(user));
        return () => {};
      };
    `,
  }));

  await page.route('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      export const getFirestore = () => ({});
      export const collection = (_db, ...parts) => ({ path: parts.join('/') });
      export const orderBy = (...parts) => ({ type: 'orderBy', parts });
      export const query = (source) => source;
      export const getDocs = async (source) => ({
        docs: (globalThis.__statisticsFixture?.[source.path] || []).map((data, index) => ({
          id: data.id || String(index),
          data: () => ({ ...data }),
        })),
      });
    `,
  }));
}
