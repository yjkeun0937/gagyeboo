# 가계부

개인용 가계부 웹앱. 데스크톱·모바일 Chrome에서 쓰며, 데이터는 사용하는 기기의 브라우저(IndexedDB)에 저장됩니다.

- 앱 주소: https://yjkeun0937.github.io/gagyeboo/
- 이 저장소는 공개 저장소입니다. **개인 데이터(엑셀·CSV·백업 JSON)와 실명은 절대 올리지 않습니다.**
  앱 소스에는 이름이 들어 있지 않고, 화면 확인용 샘플 데이터는 가상의 이름만 사용합니다.

## 개발

```bash
npm install
npm run dev         # 개발 서버
npm test            # 단위 테스트 (vitest)
npm run build       # 타입 검사 + 빌드 → dist/
npm run preview     # 빌드 결과 미리보기 (http://localhost:4173/gagyeboo/)
```

화면 흐름 점검(빌드 후 `npm run preview`를 띄운 상태에서):

```bash
CHROME=/path/to/chrome node e2e/flows.mjs   # 입력·수정·삭제·필터·백업/복원 흐름
CHROME=/path/to/chrome node e2e/shots.mjs   # 3종 화면 크기 캡처 → e2e/out/ (git 제외)
```

## 구성

- Vite + TypeScript + Preact (+ signals), Dexie(IndexedDB)
- `src/lib` 순수 로직(날짜·집계·필터), `src/store` 저장소, `src/ui` 공통 화면 요소, `src/views` 화면
- 배포: `main`에 푸시하면 GitHub Actions가 GitHub Pages로 배포합니다.

## 릴리스

| 릴리스 | 내용 |
| --- | --- |
| R1 | 사용 내역, 지출 입력·수정·삭제·복사·실행 취소, 목록 관리(사용자·지불수단·결제상세·분류), 화면 설정, 백업·복원 |
| R2 | 고정지출(설정 등록 · 월초 선택 입력 · 보류/예상), 통계(월간·연간·기간 지정), 날짜 정렬 전환, 월간 목표 지출액 경고, 오늘 이후 내역 표시 옵션 |
| R3 | 구글 로그인, 기기 간 동기화 |
| R4 | 엑셀 가져오기·내보내기 |
| R5 | 검색·달력·PWA 등 다듬기 |
