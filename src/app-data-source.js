function plainEntry(doc) {
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
