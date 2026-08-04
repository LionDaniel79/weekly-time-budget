import { normalizeGoalType } from './goal-domain.js';

function plainEntry(doc) {
  const data = doc.data();
  const createdAt = data.createdAt?.toMillis?.()
    ?? (Number(data.localCreatedAt || 0) || Date.now());
  return { id: doc.id, ...data, createdAt };
}

const plainDocument = (doc) => ({ id: doc.id, ...doc.data() });

export function createAppDataSource({ firebase, db }) {
  if (!firebase || !db) throw new Error('Firestore data source dependencies are required.');

  const userCollection = (userId, name) => firebase.collection(db, 'users', userId, name);
  const userDocument = (userId, collectionName, id) => firebase.doc(db, 'users', userId, collectionName, id);

  return {
    async loadUserData(userId) {
      const [categorySnapshot, archivedSnapshot, entrySnapshot] = await Promise.all([
        firebase.getDocs(firebase.query(userCollection(userId, 'categories'), firebase.orderBy('order'))),
        firebase.getDocs(userCollection(userId, 'archivedCategories')),
        firebase.getDocs(firebase.query(userCollection(userId, 'entries'), firebase.orderBy('date', 'desc'))),
      ]);
      return {
        categories: categorySnapshot.docs.map(plainDocument),
        archivedCategories: archivedSnapshot.docs.map(plainDocument),
        entries: entrySnapshot.docs.map(plainEntry),
      };
    },

    async saveCategory(userId, { id, payload }) {
      const collectionRef = userCollection(userId, 'categories');
      if (id) {
        await firebase.setDoc(firebase.doc(collectionRef, id), payload, { merge: true });
        return id;
      }
      const created = await firebase.addDoc(collectionRef, payload);
      return created.id;
    },

    async archiveCategory(userId, categoryId) {
      const activeRef = userDocument(userId, 'categories', categoryId);
      const snapshot = await firebase.getDoc(activeRef);
      if (!snapshot.exists()) throw new Error('보관할 대분류를 찾을 수 없습니다.');
      const batch = firebase.writeBatch(db);
      batch.set(userDocument(userId, 'archivedCategories', categoryId), {
        ...snapshot.data(),
        archivedAt: firebase.serverTimestamp(),
      });
      batch.delete(activeRef);
      await batch.commit();
    },

    async restoreCategory(userId, categoryId) {
      const archivedRef = userDocument(userId, 'archivedCategories', categoryId);
      const snapshot = await firebase.getDoc(archivedRef);
      if (!snapshot.exists()) throw new Error('복원할 대분류를 찾을 수 없습니다.');
      const data = snapshot.data();
      const { archivedAt, ...activeData } = data;
      const batch = firebase.writeBatch(db);
      batch.set(userDocument(userId, 'categories', categoryId), {
        ...activeData,
        goalType: normalizeGoalType(data.goalType),
        ...(data.createdDate !== undefined ? { createdDate: data.createdDate } : {}),
      }, { merge: true });
      batch.delete(archivedRef);
      await batch.commit();
    },

    async deleteCategory(userId, categoryId) {
      await firebase.deleteDoc(userDocument(userId, 'categories', categoryId));
    },

    async deleteEntry(userId, entryId) {
      await firebase.deleteDoc(userDocument(userId, 'entries', entryId));
    },
  };
}
