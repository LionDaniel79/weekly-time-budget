# GitHub Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the static weekly-time-budget app at `https://liondaniel79.github.io/weekly-time-budget/` and automatically redeploy tested `main` branch changes without committing the real Firebase web configuration.

**Architecture:** A focused Node script prepares an isolated `_site` artifact by copying only runtime files and generating `firebase-config.js` from GitHub Actions repository variables. A GitHub Pages workflow runs the full test suite, prepares the artifact, uploads it with the official Pages actions, and deploys only after all checks succeed. Firebase Authentication and Firestore remain the runtime backend; GitHub Pages serves only static files.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js 22, Node built-in test runner, GitHub Actions, GitHub Pages, Firebase Authentication, Cloud Firestore.

## Global Constraints

- The production URL is `https://liondaniel79.github.io/weekly-time-budget/`.
- Firebase Hosting is not used.
- Production deploys occur only from pushes to `main` or an explicit `workflow_dispatch` run.
- `npm test` must pass before any Pages artifact is uploaded.
- The repository version of `firebase-config.js` must remain the `REPLACE_ME` local-development placeholder.
- Real Firebase values must come from GitHub Actions repository variables, never from committed source files.
- Required variables are `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, and `FIREBASE_APP_ID`.
- `FIREBASE_MEASUREMENT_ID` is optional.
- The deployed artifact contains only `index.html`, `styles.css`, `src/`, generated `firebase-config.js`, and `.nojekyll`.
- The deployed artifact must not contain `.github/`, `tests/`, `docs/`, `node_modules/`, `package.json`, `firestore.rules`, or the placeholder `firebase-config.js`.
- All application asset references must remain relative so the app works under `/weekly-time-budget/`.
- Firebase Authentication must authorize the host `liondaniel79.github.io`.
- Firestore rules must continue to restrict `/users/{userId}/...` to the matching authenticated user.
- The Firebase project remains on the Spark plan with no billing account attached.

---

## File Structure

- Create `scripts/prepare-pages-site.mjs`: validates Firebase environment variables, generates the production Firebase module, and builds the `_site` directory.
- Create `tests/pages-deployment.test.js`: tests configuration generation, missing-variable failure, artifact inclusion, artifact exclusion, and relative asset paths.
- Create `tests/pages-workflow.test.js`: statically validates the GitHub Pages workflow trigger, permissions, test gate, variables, artifact path, and official deploy actions.
- Create `.github/workflows/deploy-pages.yml`: runs tests, prepares the site, uploads the Pages artifact, and deploys it.
- Modify `package.json`: adds the `prepare:pages` command without adding dependencies.
- Modify `README.md`: documents GitHub/Firebase one-time setup, routine release flow, live URL, diagnostics, and rollback.

---

### Task 1: Production Artifact Builder

**Files:**
- Create: `scripts/prepare-pages-site.mjs`
- Create: `tests/pages-deployment.test.js`

**Interfaces:**
- Consumes: `process.env`, repository root files `index.html`, `styles.css`, and `src/`.
- Produces: `REQUIRED_FIREBASE_VARIABLES: readonly string[]`, `createFirebaseConfigSource(env: Record<string, string | undefined>): string`, and `preparePagesSite(options?: { rootDir?: string, outputDir?: string, env?: Record<string, string | undefined> }): Promise<string>` where the promise resolves to the output directory path.

- [ ] **Step 1: Write tests for required Firebase variables and generated module output**

Create `tests/pages-deployment.test.js` with these imports and test fixtures:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REQUIRED_FIREBASE_VARIABLES,
  createFirebaseConfigSource,
  preparePagesSite,
} from '../scripts/prepare-pages-site.mjs';

const completeEnv = {
  FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_AUTH_DOMAIN: 'weekly-time-budget.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'weekly-time-budget',
  FIREBASE_STORAGE_BUCKET: 'weekly-time-budget.firebasestorage.app',
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
```

Add the following tests:

```js
test('Firebase 필수 변수 목록은 배포에 필요한 여섯 값을 고정한다', () => {
  assert.deepEqual(REQUIRED_FIREBASE_VARIABLES, [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
  ]);
});

test('Firebase 설정 모듈은 저장소 변수 값을 유효한 ES 모듈로 만든다', () => {
  const source = createFirebaseConfigSource(completeEnv);
  assert.match(source, /^export const firebaseConfig = /);
  assert.match(source, /"apiKey": "test-api-key"/);
  assert.match(source, /"measurementId": "G-TEST123"/);
  assert.doesNotMatch(source, /FIREBASE_API_KEY/);
  assert.doesNotMatch(source, /REPLACE_ME/);
});

test('선택적인 measurementId가 비어 있으면 설정에서 제외한다', () => {
  const source = createFirebaseConfigSource({
    ...completeEnv,
    FIREBASE_MEASUREMENT_ID: '',
  });
  assert.doesNotMatch(source, /measurementId/);
});

test('필수 Firebase 변수가 없으면 누락된 이름을 모두 표시하고 실패한다', () => {
  assert.throws(
    () => createFirebaseConfigSource({ FIREBASE_API_KEY: 'present' }),
    /FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID/,
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/pages-deployment.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/prepare-pages-site.mjs`.

- [ ] **Step 3: Implement Firebase variable validation and source generation**

Create `scripts/prepare-pages-site.mjs` beginning with:

```js
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_FIREBASE_VARIABLES = Object.freeze([
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
]);

function requiredValue(env, name) {
  return String(env[name] ?? '').trim();
}

export function createFirebaseConfigSource(env) {
  const missing = REQUIRED_FIREBASE_VARIABLES.filter((name) => !requiredValue(env, name));
  if (missing.length) {
    throw new Error(`Missing Firebase deployment variables: ${missing.join(', ')}`);
  }

  const config = {
    apiKey: requiredValue(env, 'FIREBASE_API_KEY'),
    authDomain: requiredValue(env, 'FIREBASE_AUTH_DOMAIN'),
    projectId: requiredValue(env, 'FIREBASE_PROJECT_ID'),
    storageBucket: requiredValue(env, 'FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requiredValue(env, 'FIREBASE_MESSAGING_SENDER_ID'),
    appId: requiredValue(env, 'FIREBASE_APP_ID'),
  };

  const measurementId = requiredValue(env, 'FIREBASE_MEASUREMENT_ID');
  if (measurementId) config.measurementId = measurementId;

  return `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
}
```

- [ ] **Step 4: Run the focused tests and verify the configuration tests pass**

Run:

```bash
node --test tests/pages-deployment.test.js
```

Expected: the first four tests PASS; artifact tests have not yet been added.

- [ ] **Step 5: Add failing tests for exact artifact contents**

Append to `tests/pages-deployment.test.js`:

```js
test('Pages 준비는 실행 파일만 _site에 복사하고 배포 설정을 생성한다', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'weekly-time-budget-pages-'));
  const outputDir = path.join(rootDir, '_site');
  await mkdir(path.join(rootDir, 'src'), { recursive: true });
  await mkdir(path.join(rootDir, 'tests'), { recursive: true });
  await mkdir(path.join(rootDir, 'docs'), { recursive: true });
  await mkdir(path.join(rootDir, '.github'), { recursive: true });
  await writeFile(path.join(rootDir, 'index.html'), '<link rel="stylesheet" href="./styles.css"><script type="module" src="./src/app.js"></script>');
  await writeFile(path.join(rootDir, 'styles.css'), 'body{}');
  await writeFile(path.join(rootDir, 'src', 'app.js'), "import { firebaseConfig } from '../firebase-config.js';");
  await writeFile(path.join(rootDir, 'firebase-config.js'), 'export const firebaseConfig = { apiKey: "REPLACE_ME" };');
  await writeFile(path.join(rootDir, 'tests', 'secret.test.js'), 'not deployed');
  await writeFile(path.join(rootDir, 'docs', 'design.md'), 'not deployed');
  await writeFile(path.join(rootDir, '.github', 'workflow.yml'), 'not deployed');
  await writeFile(path.join(rootDir, 'package.json'), '{}');
  await writeFile(path.join(rootDir, 'firestore.rules'), 'not deployed');

  const result = await preparePagesSite({ rootDir, outputDir, env: completeEnv });

  assert.equal(result, outputDir);
  assert.equal(await exists(path.join(outputDir, 'index.html')), true);
  assert.equal(await exists(path.join(outputDir, 'styles.css')), true);
  assert.equal(await exists(path.join(outputDir, 'src', 'app.js')), true);
  assert.equal(await exists(path.join(outputDir, 'firebase-config.js')), true);
  assert.equal(await exists(path.join(outputDir, '.nojekyll')), true);
  assert.equal(await exists(path.join(outputDir, 'tests')), false);
  assert.equal(await exists(path.join(outputDir, 'docs')), false);
  assert.equal(await exists(path.join(outputDir, '.github')), false);
  assert.equal(await exists(path.join(outputDir, 'package.json')), false);
  assert.equal(await exists(path.join(outputDir, 'firestore.rules')), false);

  const deployedConfig = await readFile(path.join(outputDir, 'firebase-config.js'), 'utf8');
  assert.match(deployedConfig, /"apiKey": "test-api-key"/);
  assert.doesNotMatch(deployedConfig, /REPLACE_ME/);
});

test('Pages 준비는 이전 _site 내용을 삭제해 오래된 파일을 남기지 않는다', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'weekly-time-budget-pages-clean-'));
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

test('운영 HTML은 저장소 하위 경로에서 동작하도록 루트 절대경로를 사용하지 않는다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']\/(?!\/)/);
});
```

- [ ] **Step 6: Run the focused tests and verify RED for the missing builder**

Run:

```bash
node --test tests/pages-deployment.test.js
```

Expected: FAIL because `preparePagesSite` is not exported.

- [ ] **Step 7: Implement isolated `_site` preparation and CLI execution**

Append to `scripts/prepare-pages-site.mjs`:

```js
export async function preparePagesSite({
  rootDir = process.cwd(),
  outputDir = path.join(rootDir, '_site'),
  env = process.env,
} = {}) {
  const source = createFirebaseConfigSource(env);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(path.join(rootDir, 'index.html'), path.join(outputDir, 'index.html'));
  await cp(path.join(rootDir, 'styles.css'), path.join(outputDir, 'styles.css'));
  await cp(path.join(rootDir, 'src'), path.join(outputDir, 'src'), { recursive: true });
  await writeFile(path.join(outputDir, 'firebase-config.js'), source, 'utf8');
  await writeFile(path.join(outputDir, '.nojekyll'), '', 'utf8');

  return outputDir;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    const outputDir = await preparePagesSite();
    console.log(`Prepared GitHub Pages artifact: ${outputDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
```

Remove the unused `fileURLToPath` import if the linter-free source no longer uses it.

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --test tests/pages-deployment.test.js
npm test
```

Expected: all tests PASS and no `_site` directory is created in the repository by the tests.

- [ ] **Step 9: Commit the artifact builder**

```bash
git add scripts/prepare-pages-site.mjs tests/pages-deployment.test.js
git commit -m "feat: prepare isolated GitHub Pages artifact"
```

---

### Task 2: Package Command and Local Deployment Verification

**Files:**
- Modify: `package.json`
- Modify: `tests/pages-deployment.test.js`

**Interfaces:**
- Consumes: `preparePagesSite()` from Task 1.
- Produces: `npm run prepare:pages`, which writes a validated `_site` directory when the required environment variables are present.

- [ ] **Step 1: Add a failing package-script assertion**

Append to `tests/pages-deployment.test.js`:

```js
test('package.json은 Pages 준비 명령을 제공한다', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['prepare:pages'], 'node scripts/prepare-pages-site.mjs');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/pages-deployment.test.js
```

Expected: FAIL because `scripts.prepare:pages` is `undefined`.

- [ ] **Step 3: Add the package script**

Change `package.json` scripts to:

```json
"scripts": {
  "test": "node --test",
  "start": "npx serve .",
  "prepare:pages": "node scripts/prepare-pages-site.mjs"
}
```

Do not add a dependency or lock file; the builder uses only Node built-ins.

- [ ] **Step 4: Run tests and a local artifact preparation smoke test**

Run:

```bash
npm test
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=weekly-time-budget.firebaseapp.com \
FIREBASE_PROJECT_ID=weekly-time-budget \
FIREBASE_STORAGE_BUCKET=weekly-time-budget.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:abcdef \
npm run prepare:pages
node --check _site/src/app.js
node --check _site/src/statistics-ui.js
```

Expected: tests PASS, `_site` is created, and both syntax checks exit 0.

- [ ] **Step 5: Inspect the artifact and remove the local output**

Run:

```bash
find _site -maxdepth 2 -type f | sort
rm -rf _site
```

Expected file set: `.nojekyll`, `firebase-config.js`, `index.html`, `styles.css`, and the existing files under `src/`; no `tests`, `docs`, `.github`, `package.json`, or `firestore.rules` paths appear.

- [ ] **Step 6: Commit the package command**

```bash
git add package.json tests/pages-deployment.test.js
git commit -m "build: add Pages artifact command"
```

---

### Task 3: GitHub Pages Deployment Workflow

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Create: `tests/pages-workflow.test.js`

**Interfaces:**
- Consumes: `npm test`, `npm run prepare:pages`, and the seven `vars.FIREBASE_*` repository variables.
- Produces: a GitHub Pages deployment from the `_site` artifact on `main` push or manual dispatch.

- [ ] **Step 1: Write the failing workflow contract tests**

Create `tests/pages-workflow.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/deploy-pages.yml', import.meta.url);

async function workflow() {
  return readFile(workflowUrl, 'utf8');
}

test('Pages workflow는 main push와 수동 실행만 배포 트리거로 사용한다', async () => {
  const source = await workflow();
  assert.match(source, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /pull_request:/);
});

test('Pages workflow는 필요한 최소 권한과 동시 실행 제어를 선언한다', async () => {
  const source = await workflow();
  assert.match(source, /contents:\s*read/);
  assert.match(source, /pages:\s*write/);
  assert.match(source, /id-token:\s*write/);
  assert.match(source, /group:\s*pages/);
  assert.match(source, /cancel-in-progress:\s*false/);
});

test('Pages workflow는 테스트 후 Firebase 변수로 _site를 준비한다', async () => {
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
    assert.match(source, new RegExp(`${name}: \\${{ vars\\.${name} }}`));
  }
});

test('Pages workflow는 공식 Pages actions로 _site만 배포한다', async () => {
  const source = await workflow();
  assert.match(source, /actions\/configure-pages@v5/);
  assert.match(source, /actions\/upload-pages-artifact@v3/);
  assert.match(source, /path:\s*_site/);
  assert.match(source, /actions\/deploy-pages@v4/);
  assert.match(source, /environment:\s*\n\s*name:\s*github-pages/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/pages-workflow.test.js
```

Expected: FAIL with `ENOENT` because `.github/workflows/deploy-pages.yml` does not exist.

- [ ] **Step 3: Create the Pages workflow**

Create `.github/workflows/deploy-pages.yml` exactly as follows:

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

- [ ] **Step 4: Run workflow tests and the full test suite**

Run:

```bash
node --test tests/pages-workflow.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Verify the workflow does not expose literal Firebase values**

Run:

```bash
grep -R "AIza\|weekly-time-budget.firebaseapp.com\|1:636925309669" .github scripts tests || true
```

Expected: no real Firebase configuration value is printed. Test fixture values such as `test-api-key` are allowed.

- [ ] **Step 6: Commit the workflow**

```bash
git add .github/workflows/deploy-pages.yml tests/pages-workflow.test.js
git commit -m "ci: deploy tested main branch to GitHub Pages"
```

---

### Task 4: Operations Documentation

**Files:**
- Modify: `README.md`
- Create: `tests/pages-documentation.test.js`

**Interfaces:**
- Consumes: the variable names and release flow defined in Tasks 1–3.
- Produces: exact one-time setup, routine deployment, troubleshooting, and rollback instructions for the repository owner.

- [ ] **Step 1: Write failing documentation assertions**

Create `tests/pages-documentation.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readmeUrl = new URL('../README.md', import.meta.url);

test('README는 GitHub Pages 운영 주소와 자동 배포 흐름을 설명한다', async () => {
  const readme = await readFile(readmeUrl, 'utf8');
  assert.match(readme, /https:\/\/liondaniel79\.github\.io\/weekly-time-budget\//);
  assert.match(readme, /main.*자동.*배포/s);
  assert.match(readme, /agent\/build-mvp/);
});

test('README는 GitHub 변수와 Firebase 승인 도메인을 정확히 안내한다', async () => {
  const readme = await readFile(readmeUrl, 'utf8');
  for (const name of [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_MEASUREMENT_ID',
  ]) {
    assert.match(readme, new RegExp(name));
  }
  assert.match(readme, /liondaniel79\.github\.io/);
  assert.match(readme, /Settings.*Pages/s);
  assert.match(readme, /GitHub Actions/);
});

test('README는 배포 실패와 롤백 절차를 설명한다', async () => {
  const readme = await readFile(readmeUrl, 'utf8');
  assert.match(readme, /Missing Firebase deployment variables/);
  assert.match(readme, /git revert/);
  assert.match(readme, /Firestore.*삭제되지/s);
});
```

- [ ] **Step 2: Run the documentation tests and verify RED**

Run:

```bash
node --test tests/pages-documentation.test.js
```

Expected: FAIL because README does not yet contain the production deployment sections.

- [ ] **Step 3: Add the deployment operations section to README**

Append these sections to `README.md`, keeping the existing Firebase and local-development instructions:

```markdown
## 운영 홈페이지

GitHub Pages 운영 주소:

```text
https://liondaniel79.github.io/weekly-time-budget/
```

웹파일은 GitHub Pages가 제공하며 Google 로그인과 시간 기록 데이터는 Firebase Authentication 및 Cloud Firestore가 담당합니다. Firebase Hosting은 사용하지 않습니다.

## 최초 GitHub Pages 설정

1. GitHub 저장소의 **Settings → Pages**에서 Build and deployment Source를 **GitHub Actions**로 선택합니다.
2. **Settings → Secrets and variables → Actions → Variables**에서 다음 Repository variables를 만듭니다.

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

`FIREBASE_MEASUREMENT_ID`만 선택값이고 나머지는 필수입니다. 실제 값은 Firebase Console의 웹 앱 설정에서 확인합니다. 필수 값이 비어 있으면 배포 작업은 `Missing Firebase deployment variables` 오류로 중단됩니다.

3. Firebase Console의 **Authentication → Settings → Authorized domains**에 `liondaniel79.github.io`를 추가합니다. `/weekly-time-budget/` 경로는 입력하지 않습니다.
4. Google 로그인 공급자가 활성화되어 있는지 확인합니다.
5. `firestore.rules`의 사용자별 접근 규칙이 Firebase에 배포되어 있는지 확인합니다.
6. Firebase 프로젝트는 Spark 요금제를 유지하고 결제 계정을 연결하지 않습니다.

## 배포와 수정 흐름

```text
기능 브랜치
→ 테스트 통과
→ agent/build-mvp 병합
→ 기능 확인
→ main 병합
→ GitHub Pages 자동 배포
```

`.github/workflows/deploy-pages.yml`은 `main` push 또는 수동 실행에서 `npm test`를 먼저 수행합니다. 테스트가 성공하면 GitHub Actions 변수를 이용해 배포 전용 `firebase-config.js`를 만들고 `_site`만 게시합니다. 테스트나 설정 검증이 실패하면 기존 정상 홈페이지가 유지됩니다.

## 배포 문제 확인

- GitHub **Actions → Deploy GitHub Pages**에서 실패한 단계를 확인합니다.
- `Missing Firebase deployment variables`가 나오면 Actions Repository variables의 이름과 값을 확인합니다.
- Google 로그인이 실패하면 Firebase 승인 도메인의 `liondaniel79.github.io`, Google 공급자 활성화 상태, 브라우저 콘솔 오류를 확인합니다.
- 배포된 사이트는 `https://liondaniel79.github.io/weekly-time-budget/`에서 확인합니다.

## 운영 버전 되돌리기

문제가 있는 운영 커밋은 변경 이력이 남는 방식으로 되돌립니다.

```bash
git switch main
git pull
git revert <문제가-생긴-커밋-SHA>
git push
```

되돌림 커밋이 `main`에 올라가면 GitHub Pages가 이전 정상 코드로 자동 재배포됩니다. Firestore 데이터는 GitHub Pages 배포와 분리되어 있으므로 코드 롤백만으로 삭제되지 않습니다.
```

Ensure the nested fenced blocks are correctly closed in the actual README; use four-space indentation or distinct fence lengths where necessary so Markdown renders correctly.

- [ ] **Step 4: Run documentation and full tests**

Run:

```bash
node --test tests/pages-documentation.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit operations documentation**

```bash
git add README.md tests/pages-documentation.test.js
git commit -m "docs: explain GitHub Pages operations"
```

---

### Task 5: Feature Branch Verification and Integration into `agent/build-mvp`

**Files:**
- Verify: all files changed in Tasks 1–4

**Interfaces:**
- Consumes: complete implementation from Tasks 1–4.
- Produces: a reviewed deployment PR targeting `agent/build-mvp`.

- [ ] **Step 1: Run the complete test suite from a clean working tree**

Run:

```bash
rm -rf _site
npm test
git status --short
```

Expected: all tests PASS and the only working-tree changes are intentional source/test/documentation files, or no changes after commits.

- [ ] **Step 2: Run a production-like artifact build without real Firebase values**

Run:

```bash
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=weekly-time-budget.firebaseapp.com \
FIREBASE_PROJECT_ID=weekly-time-budget \
FIREBASE_STORAGE_BUCKET=weekly-time-budget.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:abcdef \
FIREBASE_MEASUREMENT_ID=G-TEST123 \
npm run prepare:pages
```

Expected: `_site` is created successfully.

- [ ] **Step 3: Verify artifact boundaries and JavaScript syntax**

Run:

```bash
find _site -maxdepth 3 -type f | sort
node --check _site/src/app.js
node --check _site/src/domain.js
node --check _site/src/statistics-ui.js
test ! -e _site/tests
test ! -e _site/docs
test ! -e _site/package.json
test ! -e _site/firestore.rules
grep -q 'test-api-key' _site/firebase-config.js
grep -qv 'REPLACE_ME' _site/firebase-config.js
```

Expected: all commands exit 0; only runtime files exist.

- [ ] **Step 4: Remove generated output and rerun full tests**

Run:

```bash
rm -rf _site
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Review the branch diff**

Run:

```bash
git diff agent/build-mvp...HEAD -- . ':!docs/superpowers/plans/2026-07-26-github-pages-deployment.md'
```

Verify:

- No real Firebase value appears.
- The local placeholder `firebase-config.js` is unchanged.
- The workflow deploys only from `main` or manual dispatch.
- `npm test` precedes artifact upload.
- `_site` is the only uploaded path.
- No unrelated application behavior changed.

- [ ] **Step 6: Open a pull request to `agent/build-mvp`**

Use title:

```text
ci: publish app with GitHub Pages
```

Use body:

```markdown
- generate a minimal Pages artifact from tested source files
- inject Firebase web configuration from GitHub Actions repository variables
- deploy main through the official GitHub Pages actions
- fail safely when tests or required variables are missing
- document initial setup, routine releases, troubleshooting, and rollback
```

- [ ] **Step 7: Confirm PR CI succeeds and merge only after review**

Expected: the existing CI workflow reports success. Merge the PR into `agent/build-mvp`; do not merge `agent/build-mvp` into `main` until the one-time GitHub and Firebase settings in Task 6 are complete.

---

### Task 6: One-Time Repository and Firebase Setup

**Files:**
- No repository file changes required.

**Interfaces:**
- Consumes: the merged deployment workflow on `agent/build-mvp` and Firebase web app configuration values.
- Produces: repository variables and authorized-domain settings needed for the first production run.

- [ ] **Step 1: Configure GitHub Pages source**

In GitHub:

```text
Repository → Settings → Pages → Build and deployment → Source → GitHub Actions
```

Expected: GitHub Pages is ready to accept `actions/deploy-pages` deployments.

- [ ] **Step 2: Add GitHub Actions repository variables**

In GitHub:

```text
Repository → Settings → Secrets and variables → Actions → Variables → New repository variable
```

Create these exact names using values copied from Firebase Console → Project settings → Your apps → Web app configuration:

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

Expected: the first six variables have non-empty values. `FIREBASE_MEASUREMENT_ID` may be omitted if Analytics is not used.

- [ ] **Step 3: Add the GitHub Pages host to Firebase Authentication**

In Firebase Console:

```text
Authentication → Settings → Authorized domains → Add domain
```

Add exactly:

```text
liondaniel79.github.io
```

Expected: the domain appears without protocol and without `/weekly-time-budget/`.

- [ ] **Step 4: Verify backend prerequisites**

In Firebase Console, confirm:

- Authentication → Sign-in method → Google is enabled.
- Firestore Database exists.
- Published Firestore rules are equivalent to:

```text
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

- Project usage plan is Spark.
- No billing account is attached.

Expected: all five conditions are true before the production merge.

---

### Task 7: First Production Release to `main`

**Files:**
- No new implementation files; this task integrates the verified `agent/build-mvp` state.

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: the first live GitHub Pages release and a verified rollback point.

- [ ] **Step 1: Compare development integration with production**

Run or inspect the GitHub comparison:

```bash
git fetch origin
git log --oneline origin/main..origin/agent/build-mvp
git diff --stat origin/main...origin/agent/build-mvp
```

Expected: the comparison includes the approved application work and deployment infrastructure, with no unexpected real Firebase value.

- [ ] **Step 2: Open a release pull request from `agent/build-mvp` to `main`**

Use title:

```text
release: publish weekly time budget app
```

The PR body must state:

```markdown
- publish the tested weekly time budget application
- enable automatic GitHub Pages deployment from main
- keep Firebase Authentication and Firestore as the backend
- use GitHub Actions variables for production Firebase configuration
```

- [ ] **Step 3: Confirm the release PR test workflow succeeds**

Expected: the existing `CI` workflow passes. The Pages deployment workflow does not deploy on the pull request because it has no `pull_request` trigger.

- [ ] **Step 4: Merge the release PR into `main`**

Expected: the `Deploy GitHub Pages` workflow starts from the new `main` push.

- [ ] **Step 5: Verify the deployment workflow**

In GitHub Actions, open `Deploy GitHub Pages` and verify these steps are green:

```text
Run tests
Prepare Pages artifact
Configure Pages
Upload Pages artifact
Deploy to GitHub Pages
```

Expected: the deployment environment URL is `https://liondaniel79.github.io/weekly-time-budget/` or the equivalent canonical Pages URL GitHub reports.

- [ ] **Step 6: Perform live smoke tests**

At the live URL:

1. Load the login page over HTTPS with no missing CSS or JavaScript errors.
2. Click `Google로 시작하기` and complete Google login.
3. Confirm the dashboard loads.
4. Add or edit a test category and confirm persistence after refresh.
5. Enter a short manual time record and confirm it appears in dashboard, history, and statistics.
6. Open weekly, monthly, yearly, monthly-comparison, and yearly-comparison statistics on a mobile-width screen.
7. Confirm no page-wide horizontal scrollbar appears.
8. Log out and log in again; confirm the same Firestore data remains.

Expected: all eight checks pass.

- [ ] **Step 7: Record the production rollback point**

Record the merged `main` commit SHA and successful Pages workflow run URL in the release PR comment.

Expected: future incidents can be handled with:

```bash
git revert <problematic-main-commit>
```

and the revert push triggers an automatic Pages redeployment without deleting Firestore data.
