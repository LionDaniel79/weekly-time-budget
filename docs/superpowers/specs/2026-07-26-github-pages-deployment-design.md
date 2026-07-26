# GitHub Pages 운영 배포 설계

## 목표

`weekly-time-budget` 웹앱을 GitHub Pages에 게시하고, 이후 수정사항이 `main` 브랜치에 반영될 때 자동으로 다시 배포되도록 한다.

운영 주소는 다음을 기본값으로 한다.

```text
https://liondaniel79.github.io/weekly-time-budget/
```

Firebase Hosting은 사용하지 않는다. 웹파일은 GitHub Pages가 제공하고, Google 로그인과 시간 기록 데이터는 기존 Firebase Authentication 및 Cloud Firestore가 계속 담당한다.

## 현재 구조

- Vanilla HTML, CSS, JavaScript 정적 웹앱이다.
- `npm test`는 Node 내장 테스트를 실행한다.
- 별도의 애플리케이션 빌드 과정이 없다.
- Firebase JavaScript SDK는 브라우저에서 CDN 모듈로 불러온다.
- Firestore 규칙은 인증된 사용자가 자신의 `/users/{uid}/...` 데이터만 읽고 쓰도록 제한한다.
- 실제 Firebase 설정값은 저장소의 `firebase-config.js`에 커밋하지 않고 현재 자리표시자를 유지한다.

## 선택한 배포 방식

### GitHub Pages 사용자 지정 Actions 워크플로

`.github/workflows/deploy-pages.yml`을 추가한다.

워크플로는 다음 순서로 실행한다.

1. `main` 브랜치에 push되거나 수동 실행된다.
2. 저장소를 checkout한다.
3. Node.js를 설정하고 `npm test`를 실행한다.
4. GitHub Actions 저장소 변수로 실제 `firebase-config.js`를 생성한다.
5. 배포에 필요한 정적 파일만 `_site` 디렉터리로 복사한다.
6. `_site`를 GitHub Pages 아티팩트로 업로드한다.
7. 테스트와 준비 단계가 성공했을 때만 GitHub Pages에 배포한다.

GitHub Pages는 사용자 지정 워크플로에서 `actions/upload-pages-artifact`와 `actions/deploy-pages`를 사용하는 공식 방식을 따른다.

## Firebase 설정값 관리

Firebase 웹 설정값은 브라우저에 전달되는 공개 식별값이지만, 저장소의 소스 파일에는 실제 값을 직접 커밋하지 않는다.

GitHub 저장소의 **Settings → Secrets and variables → Actions → Variables**에 다음 저장소 변수를 등록한다.

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

`FIREBASE_MEASUREMENT_ID`는 선택값이다. 값이 없으면 생성 파일에서 제외한다.

`scripts/generate-firebase-config.mjs`는 필수 변수가 비어 있으면 명확한 오류를 내고 배포를 중단한다. 모든 필수 값이 있으면 배포용 `_site/firebase-config.js`를 생성한다.

Firebase API 키는 Firebase 프로젝트 식별에 사용되며 데이터 접근 권한을 부여하는 비밀번호가 아니다. 실제 데이터 보호는 Firestore Security Rules와 Firebase Authentication이 담당한다. 그래도 다른 Google Cloud API에 같은 키를 사용하지 않고, 필요한 경우 Google Cloud Console에서 API 및 웹사이트 제한을 적용한다.

## 배포 파일 범위

배포 아티팩트에는 다음이 포함된다.

- `index.html`
- `styles.css`
- `src/`
- 배포 시 생성한 `firebase-config.js`
- 아이콘·이미지 등 정적 자산이 생기면 해당 자산 디렉터리
- `.nojekyll`

다음은 배포하지 않는다.

- `.git/`, `.github/`
- `tests/`
- `docs/`
- `node_modules/`
- `package.json`, lock 파일
- `firestore.rules`
- 로컬 개발용 자리표시자 `firebase-config.js`

현재 모든 URL이 `./` 상대 경로이므로 `/weekly-time-budget/` 하위 경로에서도 작동한다. 루트 절대경로(`/src/...`)는 사용하지 않는다.

## Firebase Console 수동 설정

최초 배포 전에 다음을 확인한다.

1. Firebase Authentication에서 Google 공급자가 활성화되어 있다.
2. Firebase Authentication의 승인된 도메인에 `liondaniel79.github.io`를 추가한다.
3. Firestore Database가 생성되어 있다.
4. 저장소의 `firestore.rules`와 동일한 규칙이 Firebase에 배포되어 있다.
5. Firebase 프로젝트는 Spark 요금제를 유지하고 결제 계정을 연결하지 않는다.

GitHub Pages 프로젝트 경로(`/weekly-time-budget/`)는 승인 도메인에 넣지 않는다. 도메인만 `liondaniel79.github.io`로 등록한다.

## GitHub 저장소 수동 설정

최초 배포 시 GitHub에서 다음을 수행한다.

1. **Settings → Pages**로 이동한다.
2. Build and deployment의 Source를 **GitHub Actions**로 설정한다.
3. Actions 저장소 변수를 등록한다.
4. 배포 워크플로가 처음 성공한 뒤 표시되는 Pages URL을 확인한다.

## 브랜치와 운영 흐름

- `main`: 실제 홈페이지 운영 버전
- `agent/build-mvp`: 다음 배포를 준비하고 확인하는 개발 통합 브랜치
- 기능 브랜치: 개별 수정과 오류 수정

일상적인 수정 흐름은 다음과 같다.

```text
기능 브랜치 수정
→ 자동 테스트
→ agent/build-mvp 병합
→ 로컬 또는 검토 환경 확인
→ main 병합
→ GitHub Pages 자동 재배포
```

개발 중인 변경은 `agent/build-mvp`에 머물고, 사용자가 운영 반영을 결정했을 때만 `main`에 병합한다.

## 최초 게시 절차

1. 배포 워크플로와 생성 스크립트를 기능 브랜치에서 구현한다.
2. 테스트와 워크플로 정적 검증을 통과시킨다.
3. `agent/build-mvp`에 병합한다.
4. GitHub Actions 변수와 Firebase 승인 도메인을 수동 설정한다.
5. `agent/build-mvp`를 `main`에 병합한다.
6. Pages 배포 작업의 성공을 확인한다.
7. 실제 Pages 주소에서 Google 로그인, 대분류 저장, 시간 기록, 통계를 점검한다.

## 오류 처리

### 설정값 누락

Firebase 필수 변수가 하나라도 누락되면 생성 스크립트가 변수 이름을 표시하고 종료 코드 1로 실패한다. 잘못된 빈 설정으로 사이트를 게시하지 않는다.

### 테스트 실패

`npm test`가 실패하면 배포 작업은 실행되지 않는다. 이전 정상 사이트는 그대로 유지된다.

### Pages 배포 실패

GitHub Actions 로그에서 실패한 단계를 확인한다. 새 배포가 완료되지 않으면 기존에 성공한 Pages 배포본이 유지된다.

### Google 로그인 실패

다음 순서로 확인한다.

1. Firebase 승인 도메인에 `liondaniel79.github.io`가 있는지 확인
2. Google 공급자가 활성화되었는지 확인
3. 배포된 `firebase-config.js`의 프로젝트 값 확인
4. 브라우저 콘솔의 Firebase 오류 코드 확인

## 롤백

운영 문제 발생 시 두 가지 방식을 지원한다.

1. 문제 커밋을 `git revert`하여 `main`에 반영한다.
2. GitHub Actions의 정상 커밋을 기준으로 다시 배포한다.

권장 방식은 변경 이력이 보존되는 `git revert`이다. 되돌림 커밋이 `main`에 올라오면 Pages가 자동으로 이전 정상 코드에 해당하는 사이트를 다시 게시한다.

Firestore 데이터는 GitHub Pages 배포와 분리되어 있으므로 코드 롤백만으로 데이터가 삭제되지 않는다. 데이터 구조를 바꾸는 배포는 이전 버전과의 호환성을 별도로 검토한다.

## 검증 기준

구현 완료 조건은 다음과 같다.

- 배포 워크플로가 `main` push와 수동 실행을 지원한다.
- 배포 전에 전체 테스트가 실행된다.
- 실제 Firebase 설정값이 저장소 파일에 직접 커밋되지 않는다.
- 필수 설정 누락 시 배포가 실패한다.
- Pages 아티팩트에 개발·테스트 파일이 포함되지 않는다.
- `/weekly-time-budget/` 경로에서 CSS와 JavaScript가 정상 로드된다.
- Pages URL에서 Google 로그인이 동작한다.
- 로그인한 사용자가 자신의 Firestore 데이터만 읽고 쓸 수 있다.
- 운영 문제 발생 시 커밋 되돌림으로 재배포할 수 있다.

## 범위 밖

이번 배포 작업에는 다음을 포함하지 않는다.

- 개인 도메인 연결
- Firebase App Check 도입
- 오프라인 PWA 설치 기능
- 모니터링·분석 대시보드
- 유료 서비스 전환
- Firestore 데이터 마이그레이션
