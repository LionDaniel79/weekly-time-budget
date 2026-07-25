# Weekly Time Budget

류비셰프식 실제 시간 기록과 **월요일~주일 주간 시간 예산**을 결합한 개인용 웹앱입니다.

## 주요 기능

- Google 로그인만 지원
- 사용자가 대분류 추가·수정·보관·완전 삭제
- 대분류 순서를 위·아래로 변경하고 모든 화면에 같은 순서 적용
- 대분류 드롭다운을 사용하는 타이머
- 대분류 드롭다운을 사용하는 수동 시간 입력
- 타이머와 수동 입력에서 마지막 선택 대분류를 각각 기억
- 선택 메모
- 월요일~주일 주간 예산
- 실제 시간, 달성률(%), 남은 시간과 초과 시간
- 최근 기록 조회·검색·삭제
- 월간 통계와 연간 통계
- 한 해의 월별 비교와 여러 연도의 연도별 비교
- 보관된 대분류 이름을 과거 기록과 통계에 유지
- 모바일·PC 반응형 화면

주일 기록도 대시보드, 주간 달성률, 월간·연간 통계와 모든 비교에 포함됩니다.

## Firebase 설정

1. Firebase Console에서 프로젝트를 생성합니다.
2. Authentication > Sign-in method에서 **Google** 공급자를 활성화합니다.
3. Firestore Database를 생성합니다.
4. 웹 앱을 등록한 뒤 표시되는 설정값을 `firebase-config.js`에 입력합니다.
5. `firestore.rules` 내용을 Firebase의 Firestore Rules에 배포합니다.
6. Authentication > Settings > Authorized domains에 실제 배포 도메인을 추가합니다.

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

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

도메인 테스트는 월요일~주일 범위, 달성률, 자정 넘김 시간 계산, 대분류별 주간 집계, 월간·연간 범위와 기간별 비교 집계를 검증합니다.
