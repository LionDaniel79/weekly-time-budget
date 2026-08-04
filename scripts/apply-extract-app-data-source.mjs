import { readFile, writeFile, mkdir } from 'node:fs/promises';

await mkdir('src', { recursive: true });
await writeFile('src/app-data-source.js', `function plainEntry(doc) {
  const data = doc.data();
  const createdAt = data.createdAt?.toMillis?.()
    ?? (Number(data.localCreatedAt || 0) || Date.now());
  return { id: doc.id, ...data, createdAt };
}

export function createAppDataSource({ firebase, db }) {
  if (!firebase || !db) throw new Error('Firestore data source dependencies are required.');

  return {
    async loadUserData(userId) {
      const root = ['users', userId];
      const [categorySnapshot, entrySnapshot] = await Promise.all([
        firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'categories'), firebase.orderBy('order'))),
        firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'entries'), firebase.orderBy('date', 'desc'))),
      ]);
      return {
        categories: categorySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        entries: entrySnapshot.docs.map(plainEntry),
      };
    },
  };
}
`);

let app = await readFile('src/app.js', 'utf8');
app = app.replace("import { firebaseConfig } from '../firebase-config.js';\n", "import { firebaseConfig } from '../firebase-config.js';\nimport { createAppDataSource } from './app-data-source.js';\n");
app = app.replace('let firebase;\nlet loadingData = false;', 'let firebase;\nlet dataSource;\nlet loadingData = false;');
app = app.replace(/\nfunction plainEntry\(doc\) \{[\s\S]*?\n\}\n\nfunction applySnapshotToState/, '\nfunction applySnapshotToState');
app = app.replace('  firebase = { ...authModule, ...storeModule };\n', '  firebase = { ...authModule, ...storeModule };\n  dataSource = createAppDataSource({ firebase, db });\n');
app = app.replace(/    const root = \['users', state\.user\.uid\];[\s\S]*?    state\.remoteEntries = entrySnapshot\.docs\.map\(plainEntry\);/, "    const { categories, entries } = await dataSource.loadUserData(state.user.uid);\n    state.categories = categories;\n    state.remoteEntries = entries;");
await writeFile('src/app.js', app);

let worker = await readFile('service-worker.js', 'utf8');
worker = worker.replace("  './src/app.js',", "  './src/app.js',\n  './src/app-data-source.js',");
await writeFile('service-worker.js', worker);

let workflow = await readFile('.github/workflows/ci.yml', 'utf8');
workflow = workflow.replace('          test -f _site/src/auth-feature.js\n', '          test -f _site/src/auth-feature.js\n          test -f _site/src/app-data-source.js\n');
await writeFile('.github/workflows/ci.yml', workflow);
