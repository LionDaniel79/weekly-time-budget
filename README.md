# Weekly Time Budget

류비셰프식 실제 시간 기록과 **월요일~주일 주간 시간 예산**을 결합한 개인용 웹앱입니다.

운영 주소:

```text
https://liondaniel79.github.io/weekly-time-budget/
```

웹파일은 GitHub Pages가 무료로 제공하고, Google 로그인과 시간 기록 데이터는 Firebase Authentication 및 Cloud Firestore가 담당합니다.

## 주요 기능

- Google 로그인만 지원
- 대분류 추가·수정·보관·완전 삭제 및 순서 변경
- 대분류를 선택하는 타이머와 수동 시간 입력
- 타이머와 수동 입력의 마지막 선택 대분류 기억
- 월요일~주일 주간 예산과 달성률
- 기록 내역 조회·검색·삭제
- 주별·월간·연간 통계
- 월간 비교와 연도별 비교
- 보관된 대분류 이름을 과거 기록과 통계에 유지
- 모바일·PC 반응형 화면

주일 기록도 대시보드, 주간 달성률, 월간·연간 통계와 모든 비교에 포함됩니다.

## 로컬 Firebase 설정

Firebase Console에서 프로젝트와 웹 앱을 만들고 다음을 준비합니다.

1. Authentication → Sign-in method에서 **Google** 공급자를 활성화합니다.
2. Firestore Database를 생성합니다.
3. `firestore.rules` 내용을 Firebase의 Firestore Rules에 배포합니다.
4. 웹 앱 설정값을 로컬 `firebase-config.js`에 입력합니다.

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  measurementId: "..."
};
```

저장소의 기본 `firebase-config.js`는 `REPLACE_ME` 자리표시자를 유지합니다. 실제 운영 설정값은 GitHub Actions가 배포할 때 별도의 파일로 생성합니다.

## 로컬 실행

```bash
npm install
npm start
```

표시되는 로컬 주소로 접속합니다. Google 로그인 팝업이 동작하려면 해당 호스트가 Firebase 승인 도메인에 포함되어야 합니다.

## 테스트

```bash
npm test
```

전체 테스트에는 시간 계산, 통계, 모바일 화면, 배포 아티팩트와 GitHub Pages 워크플로 계약 검사가 포함됩니다.

## GitHub Pages 최초 설정

### 1. Pages 배포 방식 선택

GitHub 저장소에서 다음 메뉴로 이동합니다.

```text
Settings → Pages → Build and deployment → Source → GitHub Actions
```

### 2. Firebase 설정을 GitHub Actions 변수로 등록

다음 메뉴로 이동합니다.

```text
Settings → Secrets and variables → Actions → Variables → New repository variable
```

Firebase Console의 **Project settings → Your apps → Web app configuration**에서 값을 확인하여 다음 이름으로 등록합니다.

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

앞의 여섯 변수는 필수입니다. `FIREBASE_MEASUREMENT_ID`는 Analytics를 사용하지 않으면 생략할 수 있습니다.

### 3. Firebase 승인 도메인 추가

Firebase Console에서 다음 메뉴로 이동합니다.

```text
Authentication → Settings → Authorized domains → Add domain
```

다음 도메인만 입력합니다.

```text
liondaniel79.github.io
```

`https://`나 `/weekly-time-budget/` 경로는 입력하지 않습니다.

### 4. 비용 안전 설정 확인

Firebase 프로젝트는 **Spark 요금제**를 유지하고 결제 계정을 연결하지 않습니다. 이 상태에서는 무료 할당량을 넘더라도 자동으로 유료 청구되는 대신 해당 서비스 사용이 제한될 수 있습니다.

Firestore Rules는 인증된 사용자가 자기 데이터만 읽고 쓰도록 유지합니다.

```text
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

## 자동 배포 방식

`.github/workflows/deploy-pages.yml`은 `main` 브랜치에 변경이 반영되거나 수동 실행될 때 다음 순서로 동작합니다.

```text
전체 테스트
→ Firebase 변수 검증
→ 최소 _site 아티팩트 생성
→ GitHub Pages 업로드
→ 홈페이지 자동 배포
```

테스트 실패나 Firebase 필수 변수 누락이 있으면 새 배포는 중단되고 이전 정상 홈페이지는 유지됩니다.

## 일반 수정 및 배포 흐름

```text
기능 브랜치에서 수정
→ 자동 테스트
→ agent/build-mvp에 병합
→ 기능 확인
→ main에 병합
→ GitHub Pages 자동 배포
```

개발 중 변경사항은 `agent/build-mvp`에 두고, 실제 홈페이지에 적용할 준비가 끝났을 때만 `main`에 병합합니다.

## 배포 실패 확인

GitHub 저장소의 **Actions** 탭에서 `Deploy GitHub Pages` 작업을 엽니다. 다음 단계 중 실패한 곳을 확인합니다.

- Run tests
- Prepare Pages artifact
- Configure GitHub Pages
- Upload Pages artifact
- Deploy to GitHub Pages

Google 로그인이 실패하면 다음을 확인합니다.

1. Firebase 승인 도메인에 `liondaniel79.github.io`가 있는지 확인
2. Google 로그인 공급자가 활성화됐는지 확인
3. GitHub Actions 변수 이름과 값이 정확한지 확인
4. 브라우저 개발자 도구의 Firebase 오류 코드를 확인

## 롤백

운영 문제를 일으킨 `main` 커밋을 되돌리면 GitHub Pages가 이전 정상 코드를 자동 재배포합니다.

```bash
git revert <문제가-생긴-main-커밋-SHA>
git push
```

코드 롤백은 Firestore 데이터를 삭제하지 않습니다. 데이터 구조를 바꾸는 배포는 이전 버전과의 호환성을 별도로 확인해야 합니다.
