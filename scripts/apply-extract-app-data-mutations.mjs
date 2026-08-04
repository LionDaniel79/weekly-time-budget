import { readFile, writeFile } from 'node:fs/promises';

const dataPath = 'src/app-data-source.js';
let data = await readFile(dataPath, 'utf8');
data = data.replace(/\n  return \{\n    async loadUserData\(userId\) \{/, `\n  return {\n    async loadUserData(userId) {`);
data = data.replace(/\n    \},\n  \};\n\}/, `\n    },\n\n    async saveCategory(userId, { id, payload }) {\n      const collectionRef = firebase.collection(db, 'users', userId, 'categories');\n      if (id) {\n        await firebase.setDoc(firebase.doc(collectionRef, id), payload, { merge: true });\n        return id;\n      }\n      const created = await firebase.addDoc(collectionRef, payload);\n      return created.id;\n    },\n\n    async deleteCategory(userId, categoryId) {\n      await firebase.deleteDoc(firebase.doc(db, 'users', userId, 'categories', categoryId));\n    },\n\n    async deleteEntry(userId, entryId) {\n      await firebase.deleteDoc(firebase.doc(db, 'users', userId, 'entries', entryId));\n    },\n  };\n}`);
await writeFile(dataPath, data);

const appPath = 'src/app.js';
let app = await readFile(appPath, 'utf8');
app = app.replace(`  const collectionRef = firebase.collection(db, 'users', state.user.uid, 'categories');\n  if (id) {\n    await firebase.setDoc(firebase.doc(collectionRef, id), basePayload, { merge: true });\n  } else {\n    await firebase.addDoc(collectionRef, {\n      ...basePayload,\n      goalType: normalizeGoalType(goalType),\n      createdDate: toDateKey(new Date()),\n    });\n  }`, `  await dataSource.saveCategory(state.user.uid, {\n    id,\n    payload: id ? basePayload : {\n      ...basePayload,\n      goalType: normalizeGoalType(goalType),\n      createdDate: toDateKey(new Date()),\n    },\n  });`);
app = app.replace(`  await firebase.deleteDoc(firebase.doc(db, 'users', state.user.uid, 'categories', id));`, `  await dataSource.deleteCategory(state.user.uid, id);`);
app = app.replace(`    await firebase.deleteDoc(firebase.doc(db, 'users', state.user.uid, 'entries', id));`, `    await dataSource.deleteEntry(state.user.uid, id);`);
await writeFile(appPath, app);

const workerPath = 'service-worker.js';
let worker = await readFile(workerPath, 'utf8');
await writeFile(workerPath, worker);

const ciPath = '.github/workflows/ci.yml';
let ci = await readFile(ciPath, 'utf8');
if (!ci.includes('test -f _site/src/app-data-source.js')) {
  ci = ci.replace('          test -f _site/src/auth-feature.js\n', '          test -f _site/src/auth-feature.js\n          test -f _site/src/app-data-source.js\n');
}
await writeFile(ciPath, ci);
