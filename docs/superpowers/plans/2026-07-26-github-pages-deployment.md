# GitHub Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the tested static app at `https://liondaniel79.github.io/weekly-time-budget/` and automatically redeploy approved `main` changes without committing the real Firebase web configuration.

**Architecture:** A Node-only preparation script validates GitHub Actions variables, builds a minimal `_site` directory, and generates the production `firebase-config.js`. A custom GitHub Pages workflow runs all tests, prepares the artifact, uploads only `_site`, and deploys through the official Pages actions. Firebase Authentication and Cloud Firestore remain the backend.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js 22, Node built-in test runner, GitHub Actions, GitHub Pages, Firebase Authentication, Cloud Firestore.

## Global Constraints

- Production URL: `https://liondaniel79.github.io/weekly-time-budget/`.
- Deploy only on `main` push or `workflow_dispatch`.
- Run `npm test` before artifact upload.
- Keep committed `firebase-config.js` as the `REPLACE_ME` placeholder.
- Read real Firebase values only from GitHub Actions repository variables.
- Required variables: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`.
- Optional variable: `FIREBASE_MEASUREMENT_ID`.
- Deploy only `index.html`, `styles.css`, `src/`, generated `firebase-config.js`, and `.nojekyll`.
- Do not deploy tests, docs, workflows, package files, Firestore rules, node modules, or the placeholder config.
- Keep all browser asset references relative so `/weekly-time-budget/` works.
- Authorize `liondaniel79.github.io` in Firebase Authentication.
- Preserve user-isolated Firestore rules.
- Keep Firebase on Spark with no billing account attached.

---

## File Map

- Create `scripts/prepare-pages-site.mjs`: validates variables and builds `_site`.
- Create `tests/pages-deployment.test.js`: tests config generation and artifact boundaries.
- Create `tests/pages-workflow.test.js`: tests the workflow contract as text.
- Create `.github/workflows/deploy-pages.yml`: official Pages deployment workflow.
- Modify `package.json`: adds `prepare:pages`.
- Modify `README.md`: documents setup, releases, failures, and rollback.
- Create `tests/pages-documentation.test.js`: keeps the operational instructions from drifting.

---

### Task 1: Build a Minimal Production Artifact

**Files:**
- Create: `scripts/prepare-pages-site.mjs`
- Create: `tests/pages-deployment.test.js`

**Interfaces:**
- Produces `REQUIRED_FIREBASE_VARIABLES`.
- Produces `createFirebaseConfigSource(env): string`.
- Produces `preparePagesSite({ rootDir, outputDir, env }): Promise<string>`.

- [ ] **Step 1: Write failing configuration tests**

Create `tests/pages-deployment.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REQUIRED_FIREBASE_VARIABLES,
  createFirebaseConfigSource,
  preparePagesSite,
} from '../scripts/prepare-pages-site.mjs';

const completeEnv = {
  FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_STORAGE_BUCKET: 'test-project.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '123456789',
  FIREBASE_APP_ID: '1:123456789:web:abcdef',
  FIREBASE_MEASUREMENT_ID: 'G-TEST123',
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('Firebase 필수 변수 여섯 개를 고정한다', () => {
  assert.deepEqual(REQUIRED_FIREBASE_VARIABLES, [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
  ]);
});

test('GitHub 변수에서 유효한 Firebase ES 모듈을 만든다', () => {
  const source = createFirebaseConfigSource(completeEnv);
  assert.match(source, /^export const firebaseConfig = /);
  assert.match(source, /"apiKey": "test-api-key"/);
  assert.match(source, /"measurementId": "G-TEST123"/);
  assert.doesNotMatch(source, /REPLACE_ME/);
});

test('measurementId가 비어 있으면 생성 설정에서 제외한다', () => {
  const source = createFirebaseConfigSource({ ...completeEnv, FIREBASE_MEASUREMENT_ID: '' });
  assert.doesNotMatch(source, /measurementId/);
});

test('필수 변수가 없으면 누락 이름 전체를 표시한다', () => {
  assert.throws(
    () => createFirebaseConfigSource({ FIREBASE_API_KEY: 'present' }),
    /FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID/,
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/pages-deployment.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` for `scripts/prepare-pages-site.mjs`.

- [ ] **Step 3: Implement validation and config generation**

Create `scripts/prepare-pages-site.mjs`:

```js
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

function value(env, name) {
  return String(env[name] ?? '').trim();
}

export function createFirebaseConfigSource(env = {}) {
  const missing = REQUIRED_FIREBASE_VARIABLES.filter((name) => !value(env, name));
  if (missing.length) {
    throw new Error(`Missing Firebase deployment variables: ${missing.join(', ')}`);
  }

  const config = {
    apiKey: value(env, 'FIREBASE_API_KEY'),
    authDomain: value(env, 'FIREBASE_AUTH_DOMAIN'),
    projectId: value(env, 'FIREBASE_PROJECT_ID'),
    storageBucket: value(env, 'FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: value(env, 'FIREBASE_MESSAGING_SENDER_ID'),
    appId: value(env, 'FIREBASE_APP_ID'),
  };

  const measurementId = value(env, 'FIREBASE_MEASUREMENT_ID');
  if (measurementId) config.measurementId = measurementId;

  return `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
}
```

- [ ] **Step 4: Verify the configuration tests pass**

Run:

```bash
node --test tests/pages-deployment.test.js
```

Expected: the four tests PASS.

- [ ] **Step 5: Add failing artifact-boundary tests**

Append:

```js
test('Pages artifact는 실행 파일만 포함하고 실제 배포 설정을 생성한다', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'pages-artifact-'));
  const outputDir = path.join(rootDir, '_site');
  await mkdir(path.join(rootDir, 'src'), { recursive: true });
  await mkdir(path.join(rootDir, 'tests'), { recursive: true });
  await mkdir(path.join(rootDir, 'docs'), { recursive: true });
  await mkdir(path.join(rootDir, '.github'), { recursive: true });
  await writeFile(path.join(rootDir, 'index.html'), '<link href="./styles.css"><script type="module" src="./src/app.js"></script>');
  await writeFile(path.join(rootDir, 'styles.css'), 'body{}');
  await writeFile(path.join(rootDir, 'src', 'app.js'), "import '../firebase-config.js';");
  await writeFile(path.join(rootDir, 'firebase-config.js'), 'REPLACE_ME');
  await writeFile(path.join(rootDir, 'tests', 'x.test.js'), 'excluded');
  await writeFile(path.join(rootDir, 'docs', 'x.md'), 'excluded');
  await writeFile(path.join(rootDir, '.github', 'x.yml'), 'excluded');
  await writeFile(path.join(rootDir, 'package.json'), '{}');
  await writeFile(path.join(rootDir, 'firestore.rules'), 'excluded');

  assert.equal(await preparePagesSite({ rootDir, outputDir, env: completeEnv }), outputDir);
  for (const relative of ['index.html', 'styles.css', 'src/app.js', 'firebase-config.js', '.nojekyll']) {
    assert.equal(await exists(path.join(outputDir, relative)), true, relative);
  }
  for (const relative of ['tests', 'docs', '.github', 'package.json', 'firestore.rules']) {
    assert.equal(await exists(path.join(outputDir, relative)), false, relative);
  }
  const deployedConfig = await readFile(path.join(outputDir, 'firebase-config.js'), 'utf8');
  assert.match(deployedConfig, /test-api-key/);
  assert.doesNotMatch(deployedConfig, /REPLACE_ME/);
});

test('새 artifact 준비는 이전 _site 잔여 파일을 제거한다', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'pages-clean-'));
  const outputDir = path.join(rootDir, '_site');
  await mkdir(path.join(rootDir, 'src'), { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(rootDir, 'index.html'), '<main>app</main>');
  await writeFile(path.join(rootDir, 'styles.css'), 'body{}');
  await writeFile(path.join(rootDir, 'src', 'app.js'), 'export {};');
  await writeFile(path.join(outputDir, 'obsolete.js'), 'old');
  await preparePagesSite({ rootDir, outputDir, env: completeEnv });
  assert.equal(await exists(path.join(outputDir, 'obsolete.js')), false);
});

test('운영 HTML은 저장소 하위 경로용 상대 URL만 사용한다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']\/(?!\/)/);
});
```

- [ ] **Step 6: Verify RED for missing `preparePagesSite`**

Run:

```bash
node --test tests/pages-deployment.test.js
```

Expected: FAIL because `preparePagesSite` is not exported.

- [ ] **Step 7: Implement artifact preparation and CLI execution**

Append to `scripts/prepare-pages-site.mjs`:

```js
export async function preparePagesSite({
  rootDir = process.cwd(),
  outputDir = path.join(rootDir, '_site'),
  env = process.env,
} = {}) {
  const configSource = createFirebaseConfigSource(env);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(path.join(rootDir, 'index.html'), path.join(outputDir, 'index.html'));
  await cp(path.join(rootDir, 'styles.css'), path.join(outputDir, 'styles.css'));
  await cp(path.join(rootDir, 'src'), path.join(outputDir, 'src'), { recursive: true });
  await writeFile(path.join(outputDir, 'firebase-config.js'), configSource, 'utf8');
  await writeFile(path.join(outputDir, '.nojekyll'), '', 'utf8');
  return outputDir;
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
  try {
    console.log(`Prepared GitHub Pages artifact: ${await preparePagesSite()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 8: Run focused and full tests**

```bash
node --test tests/pages-deployment.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/prepare-pages-site.mjs tests/pages-deployment.test.js
git commit -m "feat: prepare isolated GitHub Pages artifact"
```

---

### Task 2: Add the Local Pages Command

**Files:**
- Modify: `package.json`
- Modify: `tests/pages-deployment.test.js`

- [ ] **Step 1: Add a failing script assertion**

Append:

```js
test('package.json은 Pages 준비 명령을 제공한다', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['prepare:pages'], 'node scripts/prepare-pages-site.mjs');
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/pages-deployment.test.js
```

Expected: FAIL because `prepare:pages` is undefined.

- [ ] **Step 3: Modify `package.json`**

```json
"scripts": {
  "test": "node --test",
  "start": "npx serve .",
  "prepare:pages": "node scripts/prepare-pages-site.mjs"
}
```

Do not add dependencies or a lock file.

- [ ] **Step 4: Verify a local production-like build**

```bash
npm test
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test-project.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test-project.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:abcdef \
npm run prepare:pages
find _site -maxdepth 2 -type f | sort
node --check _site/src/app.js
node --check _site/src/statistics-ui.js
rm -rf _site
```

Expected: only runtime files appear and syntax checks exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json tests/pages-deployment.test.js
git commit -m "build: add Pages artifact command"
```

---

### Task 3: Add the Official GitHub Pages Workflow

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Create: `tests/pages-workflow.test.js`

- [ ] **Step 1: Write failing workflow tests**

Create `tests/pages-workflow.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function workflow() {
  return readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
}

test('Pages workflow는 main push와 수동 실행만 사용한다', async () => {
  const source = await workflow();
  assert.match(source, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /pull_request:/);
});

test('Pages workflow는 공식 권한과 actions를 사용한다', async () => {
  const source = await workflow();
  for (const pattern of [
    /contents:\s*read/,
    /pages:\s*write/,
    /id-token:\s*write/,
    /actions\/configure-pages@v5/,
    /actions\/upload-pages-artifact@v3/,
    /actions\/deploy-pages@v4/,
    /path:\s*_site/,
  ]) assert.match(source, pattern);
});

test('Pages workflow는 테스트 후 일곱 Firebase 변수를 전달한다', async () => {
  const source = await workflow();
  assert.match(source, /run:\s*npm test/);
  assert.match(source, /run:\s*npm run prepare:pages/);
  for (const name of [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_MEASUREMENT_ID',
  ]) {
    assert.match(source, new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`));
  }
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/pages-workflow.test.js
```

Expected: `ENOENT` for the missing workflow.

- [ ] **Step 3: Create `.github/workflows/deploy-pages.yml`**

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  test-and-build:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Run tests
        run: npm test
      - name: Prepare Pages artifact
        env:
          FIREBASE_API_KEY: ${{ vars.FIREBASE_API_KEY }}
          FIREBASE_AUTH_DOMAIN: ${{ vars.FIREBASE_AUTH_DOMAIN }}
          FIREBASE_PROJECT_ID: ${{ vars.FIREBASE_PROJECT_ID }}
          FIREBASE_STORAGE_BUCKET: ${{ vars.FIREBASE_STORAGE_BUCKET }}
          FIREBASE_MESSAGING_SENDER_ID: ${{ vars.FIREBASE_MESSAGING_SENDER_ID }}
          FIREBASE_APP_ID: ${{ vars.FIREBASE_APP_ID }}
          FIREBASE_MEASUREMENT_ID: ${{ vars.FIREBASE_MEASUREMENT_ID }}
        run: npm run prepare:pages
      - name: Configure Pages
        uses: actions/configure-pages@v5
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: test-and-build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Verify GREEN**

```bash
node --test tests/pages-workflow.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Check that no Firebase API-key-shaped value was committed**

```bash
if grep -R -nE 'AIza[0-9A-Za-z_-]{20,}' .github scripts tests; then exit 1; fi
```

Expected: no output and exit 0.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy-pages.yml tests/pages-workflow.test.js
git commit -m "ci: deploy tested main branch to GitHub Pages"
```

---

### Task 4: Document Setup, Releases, and Rollback

**Files:**
- Modify: `README.md`
- Create: `tests/pages-documentation.test.js`

- [ ] **Step 1: Write failing documentation tests**

Create `tests/pages-documentation.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readme() {
  return readFile(new URL('../README.md', import.meta.url), 'utf8');
}

test('README는 운영 주소와 자동 배포 흐름을 설명한다', async () => {
  const source = await readme();
  assert.match(source, /https:\/\/liondaniel79\.github\.io\/weekly-time-budget\//);
  assert.match(source, /agent\/build-mvp/);
  assert.match(source, /main.*자동.*배포/s);
});

test('README는 변수, 승인 도메인, 실패, 롤백을 설명한다', async () => {
  const source = await readme();
  for (const text of [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_MEASUREMENT_ID',
    'liondaniel79.github.io',
    'Missing Firebase deployment variables',
    'git revert',
  ]) assert.match(source, new RegExp(text.replaceAll('.', '\\.')));
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/pages-documentation.test.js
```

Expected: tests FAIL because deployment operations are undocumented.

- [ ] **Step 3: Add exact README sections**

Add these headings and instructions:

```markdown
## 운영 홈페이지

운영 주소는 `https://liondaniel79.github.io/weekly-time-budget/`입니다. GitHub Pages가 정적 파일을 제공하고 Firebase Authentication과 Cloud Firestore가 로그인 및 데이터를 담당합니다.

## 최초 GitHub Pages 설정

1. **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.
2. **Settings → Secrets and variables → Actions → Variables**에 다음 이름을 등록합니다: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_MEASUREMENT_ID`.
3. `FIREBASE_MEASUREMENT_ID`만 선택값입니다. 나머지가 비어 있으면 `Missing Firebase deployment variables` 오류로 배포가 중단됩니다.
4. Firebase Authentication 승인 도메인에 `liondaniel79.github.io`를 추가합니다. 프로토콜과 `/weekly-time-budget/` 경로는 넣지 않습니다.
5. Google 공급자, Firestore Database, `firestore.rules`, Spark 요금제, 결제 계정 미연결 상태를 확인합니다.

## 수정과 자동 배포

`기능 브랜치 → agent/build-mvp → main → GitHub Pages 자동 배포` 순서로 운영합니다. `main` 배포 전에 `npm test`가 실행되며, 실패하면 기존 정상 사이트가 유지됩니다.

## 배포 문제 확인

GitHub Actions의 **Deploy GitHub Pages** 실행에서 실패 단계를 확인합니다. 설정 오류는 Repository variables, 로그인 오류는 Firebase 승인 도메인과 Google 공급자 상태, 화면 오류는 브라우저 콘솔을 확인합니다.

## 운영 버전 되돌리기

최근 운영 커밋을 확인한 뒤 되돌림 커밋을 생성합니다.

```bash
git switch main
git pull
git log --oneline -10
BAD_COMMIT_SHA=$(git rev-parse HEAD)
git revert "$BAD_COMMIT_SHA"
git push
```

`main`의 되돌림 커밋은 자동 재배포됩니다. Firestore 데이터는 Pages 배포와 분리되어 있으므로 코드 롤백으로 삭제되지 않습니다.
```

- [ ] **Step 4: Verify GREEN**

```bash
node --test tests/pages-documentation.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/pages-documentation.test.js
git commit -m "docs: explain GitHub Pages operations"
```

---

### Task 5: Verify and Merge Deployment Infrastructure

**Files:**
- Verify all Task 1–4 changes.

- [ ] **Step 1: Run the full clean verification**

```bash
rm -rf _site
npm test
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test-project.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test-project.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:abcdef \
FIREBASE_MEASUREMENT_ID=G-TEST123 \
npm run prepare:pages
node --check _site/src/app.js
node --check _site/src/domain.js
node --check _site/src/statistics-ui.js
test ! -e _site/tests
test ! -e _site/docs
test ! -e _site/package.json
test ! -e _site/firestore.rules
grep -q 'test-api-key' _site/firebase-config.js
grep -qv 'REPLACE_ME' _site/firebase-config.js
rm -rf _site
npm test
```

Expected: every command exits 0.

- [ ] **Step 2: Review the diff**

```bash
git diff agent/build-mvp...HEAD -- . ':!docs/superpowers/plans/2026-07-26-github-pages-deployment.md'
```

Confirm no real Firebase value, no placeholder-config modification, no unrelated app change, `npm test` before upload, and `_site` as the sole artifact path.

- [ ] **Step 3: Open a PR to `agent/build-mvp`**

Title:

```text
ci: publish app with GitHub Pages
```

Body:

```markdown
- generate a minimal Pages artifact from tested runtime files
- inject Firebase web configuration from Actions repository variables
- deploy main through the official GitHub Pages actions
- fail safely when tests or required variables are missing
- document setup, releases, troubleshooting, and rollback
```

- [ ] **Step 4: Confirm CI and merge into `agent/build-mvp`**

Expected: existing CI passes. Do not release to `main` before Task 6 is complete.

---

### Task 6: Complete One-Time GitHub and Firebase Settings

**Files:**
- No repository changes.

- [ ] **Step 1: Set Pages source**

```text
Repository → Settings → Pages → Build and deployment → Source → GitHub Actions
```

- [ ] **Step 2: Add repository variables**

```text
Repository → Settings → Secrets and variables → Actions → Variables
```

Add the seven exact names from Global Constraints using Firebase Console web-app values. The first six must be non-empty; measurement ID is optional.

- [ ] **Step 3: Add the authorized domain**

```text
Firebase Console → Authentication → Settings → Authorized domains → liondaniel79.github.io
```

- [ ] **Step 4: Verify backend safety**

Confirm Google sign-in enabled, Firestore created, these rules published, Spark selected, and no billing account attached:

```text
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

---

### Task 7: Release `agent/build-mvp` to `main`

**Files:**
- No new source files.

- [ ] **Step 1: Compare branches**

```bash
git fetch origin
git log --oneline origin/main..origin/agent/build-mvp
git diff --stat origin/main...origin/agent/build-mvp
```

- [ ] **Step 2: Open the release PR**

Title:

```text
release: publish weekly time budget app
```

Body:

```markdown
- publish the tested weekly time budget application
- enable automatic GitHub Pages deployment from main
- keep Firebase Authentication and Firestore as the backend
- use GitHub Actions variables for production Firebase configuration
```

- [ ] **Step 3: Confirm release CI and merge**

Expected: CI passes; merging starts `Deploy GitHub Pages`.

- [ ] **Step 4: Verify the live deployment**

Confirm these workflow steps are green: `Run tests`, `Prepare Pages artifact`, `Configure Pages`, `Upload Pages artifact`, `Deploy to GitHub Pages`.

At `https://liondaniel79.github.io/weekly-time-budget/`, verify HTTPS loading, Google login, dashboard, saved category persistence, manual record persistence, all five statistics modes, mobile layout without page-wide horizontal scrolling, logout, and login persistence.

- [ ] **Step 5: Record the rollback point**

Post the merged `main` commit SHA and successful Pages workflow URL in the release PR. For a future incident, select the actual bad SHA from `git log --oneline -10`, run `git revert` on that SHA, and push the revert to trigger automatic redeployment.
