import { firebaseConfig } from '../firebase-config.js';
import { createAppDataSource } from './app-data-source.js';

export function createAppBootstrap({ publishAuthState, onUserChanged, onError = console.error }) {
  const configured = !Object.values(firebaseConfig).some((value) => String(value).includes('REPLACE_ME'));
  let auth;
  let firebase;

  async function start() {
    if (!configured) {
      publishAuthState({ configured: false });
      return;
    }
    try {
      const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
      const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
      const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
      const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
      auth = authModule.getAuth(app);
      const db = storeModule.getFirestore(app);
      firebase = { ...authModule, ...storeModule };
      const dataSource = createAppDataSource({ firebase, db });
      await authModule.setPersistence(auth, authModule.browserLocalPersistence).catch((error) => {
        console.warn('로그인 상태 영속화 설정 실패', error);
      });
      authModule.onAuthStateChanged(auth, (user) => onUserChanged({ user, db, firebase, storeModule, dataSource }));
      publishAuthState({ configured: true });
    } catch (error) {
      onError(error);
      publishAuthState({ configured: false, errorMessage: `초기화 오류: ${error.message}` });
    }
  }

  return {
    configured,
    start,
    login: async () => {
      if (!firebase || !auth) throw new Error('로그인 기능을 준비하는 중입니다. 잠시 후 다시 눌러주세요.');
      await firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider());
    },
    logout: () => firebase?.signOut(auth),
  };
}
