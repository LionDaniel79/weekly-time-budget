# 절제 목표 UI 정돈 설계

## 목표

대분류 관리의 절제 목표 선택 영역을 읽기 쉬운 한 줄 구조로 정리하고, 대시보드에서 예산 이내 절제 막대의 색을 일반 성장 목표 막대와 같은 녹색으로 통일한다.

## 범위

### 1. 대분류 추가 화면

- 체크박스와 `절제 목표` 문구는 같은 줄에 표시한다.
- 보조 설명 `설정한 예산시간 이하로 사용하는 것이 목표입니다.`는 그 아래 줄에 표시한다.
- 모바일 화면에서도 체크박스와 제목은 줄바꿈되지 않는다.
- 대분류 수정 화면과 목표 방식 불변성은 변경하지 않는다.

권장 마크업 구조는 현재 구조를 유지한다.

```html
<label class="restraint-goal-option">
  <input name="restraint" type="checkbox">
  <span>
    <strong>절제 목표</strong>
    <small>설정한 예산시간 이하로 사용하는 것이 목표입니다.</small>
  </span>
</label>
```

CSS에서는 기존 `.form-grid label { display: grid; }`보다 구체적인 `.form-grid label.restraint-goal-option` 선택자를 사용해 가로 배치를 보장한다.

## 2. 대시보드 절제 막대 색상

- 예산 이내의 절제 목표 막대(`restraint-remaining`)는 일반 성장 목표 막대와 같은 `#2b7665`를 사용한다.
- 예산 정확히 소진한 상태는 기존처럼 빈 막대로 유지한다.
- 예산 초과 상태(`restraint-overage`)는 기존 빨간색 `#c23b36`을 유지한다.
- 절제 달성률 계산, 막대 너비 계산, 초과 문구는 변경하지 않는다.

## 변경 파일

- `styles.css`: 절제 선택 영역 배치와 정상 절제 막대 색상 수정
- `tests/restraint-ui-integration.test.js`: 배치·정상색·초과색 회귀 계약 추가
- `service-worker.js`: 배포 시 기존 PWA가 새 CSS를 확실히 받도록 셸 캐시 버전 갱신
- 서비스 워커 버전을 고정 검사하는 관련 테스트: 새 버전으로 갱신

## 테스트 기준

1. `.form-grid label.restraint-goal-option`이 `display: flex`와 `align-items: flex-start`를 가진다.
2. 절제 체크박스는 고정 크기이며 제목 영역 옆에 배치된다.
3. `restraint-remaining` 배경색이 일반 `.progress > span`과 같은 `#2b7665`이다.
4. `restraint-overage` 배경색은 `#c23b36`으로 유지된다.
5. 전체 테스트와 GitHub Pages 산출물 검사가 성공한다.

## 비범위

- 절제 목표 공식 변경
- 대시보드 레이아웃 재설계
- 통계 화면 색상 체계 변경
- 대분류 데이터 구조 변경
