import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

export const REQUIRED_FIREBASE_VARIABLES = Object.freeze([
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
]);

const WEB_APP_ICONS = Object.freeze({
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
});

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function valueOf(env, name) {
  return String(env?.[name] ?? '').trim();
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    pixels.copy(raw, rowOffset + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const denominator = vx * vx + vy * vy;
  const t = denominator === 0 ? 0 : clamp((wx * vx + wy * vy) / denominator);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function shapeCoverage(distance, halfWidth, antialiasWidth) {
  return clamp(0.5 + (halfWidth - distance) / (2 * antialiasWidth));
}

function createIconPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const centerX = 0.5;
  const centerY = 0.49;
  const radius = 0.3;
  const ringWidth = 0.046;
  const gapStart = (16 * Math.PI) / 180;
  const gapEnd = (75 * Math.PI) / 180;
  const antialiasWidth = 1.2 / size;
  const capStart = {
    x: centerX + radius * Math.cos(gapStart),
    y: centerY + radius * Math.sin(gapStart),
  };
  const capEnd = {
    x: centerX + radius * Math.cos(gapEnd),
    y: centerY + radius * Math.sin(gapEnd),
  };
  const segments = [
    [0.5, 0.49, 0.5, 0.315, 0.036],
    [0.5, 0.49, 0.615, 0.585, 0.036],
    [0.64, 0.7, 0.7, 0.76, 0.043],
    [0.7, 0.76, 0.82, 0.635, 0.043],
  ];

  for (let y = 0; y < size; y += 1) {
    const normalizedY = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const normalizedX = (x + 0.5) / size;
      const backgroundRadius = Math.hypot(normalizedX - 0.48, normalizedY - 0.45) / 0.78;
      const brightness = clamp(1 - backgroundRadius);
      const background = [0, 66 + 24 * brightness, 29 + 10 * brightness];

      const dx = normalizedX - centerX;
      const dy = normalizedY - centerY;
      const distanceFromCenter = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      let coverage = 0;

      if (!(angle > gapStart && angle < gapEnd)) {
        coverage = Math.max(
          coverage,
          shapeCoverage(
            Math.abs(distanceFromCenter - radius),
            ringWidth / 2,
            antialiasWidth,
          ),
        );
      }

      coverage = Math.max(
        coverage,
        shapeCoverage(
          Math.hypot(normalizedX - capStart.x, normalizedY - capStart.y),
          ringWidth / 2,
          antialiasWidth,
        ),
        shapeCoverage(
          Math.hypot(normalizedX - capEnd.x, normalizedY - capEnd.y),
          ringWidth / 2,
          antialiasWidth,
        ),
      );

      for (const [ax, ay, bx, by, width] of segments) {
        coverage = Math.max(
          coverage,
          shapeCoverage(
            segmentDistance(normalizedX, normalizedY, ax, ay, bx, by),
            width / 2,
            antialiasWidth,
          ),
        );
      }

      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(background[0] * (1 - coverage) + 252 * coverage);
      pixels[offset + 1] = Math.round(background[1] * (1 - coverage) + 252 * coverage);
      pixels[offset + 2] = Math.round(background[2] * (1 - coverage) + 252 * coverage);
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
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

export async function materializeWebAppIcons({
  outputDir = path.join(process.cwd(), 'icons'),
} = {}) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const [filename, size] of Object.entries(WEB_APP_ICONS)) {
    const pixels = createIconPixels(size);
    await writeFile(path.join(outputDir, filename), encodePng(size, size, pixels));
  }

  return outputDir;
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
  await cp(
    path.join(rootDir, 'manifest.webmanifest'),
    path.join(outputDir, 'manifest.webmanifest'),
  );
  await materializeWebAppIcons({ outputDir: path.join(outputDir, 'icons') });
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
