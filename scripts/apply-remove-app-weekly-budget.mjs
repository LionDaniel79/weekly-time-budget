import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/app.js', import.meta.url);
let source = await readFile(path, 'utf8');

const replacements = [
  ["  weeklyBudget: null,\n", ""],
  ["const effectiveBudgetMinutes = (category) => {\n  const weeklyValue = state.weeklyBudget?.budgets?.[category.id];\n  return weeklyValue === undefined ? defaultBudgetMinutes(category) : Number(weeklyValue) || 0;\n};\nconst categoriesForSummary = () => state.categories.map((category) => ({\n  ...category,\n  budgetMinutes: effectiveBudgetMinutes(category),\n}));\n", ""],
  ["  if (snapshot.weeklyBudget !== undefined) state.weeklyBudget = snapshot.weeklyBudget;\n", ""],
  ["    const [categorySnapshot, entrySnapshot, weeklySnapshot] = await Promise.all([\n      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'categories'), firebase.orderBy('order'))),\n      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'entries'), firebase.orderBy('date', 'desc'))),\n      firebase.getDoc(firebase.doc(db, ...root, 'weeklyBudgets', currentWeekKey())),\n    ]);\n", "    const [categorySnapshot, entrySnapshot] = await Promise.all([\n      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'categories'), firebase.orderBy('order'))),\n      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'entries'), firebase.orderBy('date', 'desc'))),\n    ]);\n"],
  ["    state.weeklyBudget = weeklySnapshot.exists() ? { id: weeklySnapshot.id, ...weeklySnapshot.data() } : null;\n", ""],
  ["      weeklyBudget: state.weeklyBudget,\n", ""],
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`Expected source fragment not found: ${from.slice(0, 80)}`);
  source = source.replace(from, to);
}

await writeFile(path, source);
