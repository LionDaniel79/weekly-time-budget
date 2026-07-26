import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_FIREBASE_VARIABLES = Object.freeze([
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
]);

function valueOf(env, name) {
  return String(env?.[name] ?? '').trim();
}

export function createFirebaseConfigSource(env = process.env) {
  const missing = REQUIRED_FIREBASE_VARIABLES.filter((name) => !valueOf(env, name));
  if (missing.length) {
    throw new Error(`Missing Firebase deployment variables: ${missing.join(', ')}`);
  }

  const config = {
    apiKey: valueOf(env, 'FIREBASE_API_KEY'),
    authDomain: valueOf(env, 'FIREBASE_AUTH_DOMAIN'),
    projectId: valueOf(env, 'FIREBASE_PROJECT_ID'),
    storageBucket: valueOf(env, 'FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: valueOf(env, 'FIREBASE_MESSAGING_SENDER_ID'),
    appId: valueOf(env, 'FIREBASE_APP_ID'),
  };

  const measurementId = valueOf(env, 'FIREBASE_MEASUREMENT_ID');
  if (measurementId) config.measurementId = measurementId;

  return `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
}

export async function preparePagesSite({
  rootDir = process.cwd(),
  outputDir = path.join(rootDir, '_site'),
  env = process.env,
} = {}) {
  const firebaseConfigSource = createFirebaseConfigSource(env);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(path.join(rootDir, 'index.html'), path.join(outputDir, 'index.html'));
  await cp(path.join(rootDir, 'styles.css'), path.join(outputDir, 'styles.css'));
  await cp(path.join(rootDir, 'src'), path.join(outputDir, 'src'), { recursive: true });
  await writeFile(path.join(outputDir, 'firebase-config.js'), firebaseConfigSource, 'utf8');
  await writeFile(path.join(outputDir, '.nojekyll'), '', 'utf8');

  return outputDir;
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedUrl === import.meta.url) {
  preparePagesSite()
    .then((outputDir) => {
      console.log(`Prepared GitHub Pages artifact: ${outputDir}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
