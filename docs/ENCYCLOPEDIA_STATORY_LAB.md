# 중독백과 → Statory Lab 연계 가이드

중독백과는 "같은 데이터, 다른 프론트" 원칙으로 설계되었다. 데이터·API는
중독뉴스에 종속되지 않는 공용 자원이며, Statory Lab 은 이 API 를 호출하기만 하면
동일한 172개 항목(한/영)을 그대로 쓸 수 있다. Lab 쪽에 데이터를 복제하거나
로직을 다시 만들 필요가 없다.

## 1. 공용 API (읽기 전용, 인증 불필요)

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /encyclopedia` | 전체 목록. `?category=` 필터, `?q=` 검색, `?locale=en` 영어 |
| `GET /encyclopedia/:id` | 단일 항목 상세(+ 관련항목). `?locale=en` 영어 |
| `GET /encyclopedia/link-map` | { 별칭: id } 맵. 본문 용어 자동 링크용 |

- `locale=en` 이면 definition/example/body/advanced 가 영어로 치환되어 내려온다.
  영어가 비어 있으면 한국어로 자동 폴백(깨지지 않음). 표제어는 termKo/termEn 둘 다 항상 포함.
- 응답 필드(항목): id, termKo, termEn, category, definition, example,
  body[{h,p}], advanced[{h,p}], seeAlso[], trend, sensitive, videoUrl, videoStatus.

## 2. 웹 배포 후 (localhost → 공개 도메인)

현재는 중독뉴스 백엔드가 localhost:4000. 웹 배포 시 이 API 가 공개 URL(예:
`https://api.<중독뉴스도메인>/encyclopedia`)로 노출된다. Lab 은 그 URL 을 base 로 호출.

### 필수: CORS 허용
Lab 이 다른 도메인에서 호출하므로, 중독뉴스 백엔드(NestJS)에서 Lab 도메인을
CORS 허용해야 한다. main.ts 예시:
```typescript
app.enableCors({
  origin: [
    'https://lab.statory.org',   // Statory Lab 도메인(실제 값으로)
    'https://statory.org',
    // 개발 중이면 'http://localhost:3000' 등
  ],
  methods: ['GET'],              // 백과는 읽기 전용이면 GET 만
});
```
- 백과 API 는 읽기 전용·비민감 데이터이므로 공개 GET 으로 충분.
- 쓰기(관리자 편집 PUT /admin/...)는 Lab 에 노출하지 말 것(중독뉴스 admin 전용 유지).

## 3. Statory Lab 에서 쓰는 두 가지 방식

### 방식 A) 용어 사전(glossary) / 툴팁
Lab 화면의 통계·분석 용어에 백과를 연결.
```javascript
// Lab 측 예시
const BASE = 'https://api.중독뉴스도메인/encyclopedia';
const map = await (await fetch(`${BASE}/link-map`)).json(); // { 별칭: id }
// 본문에서 용어 hover 시 상세 fetch
const term = await (await fetch(`${BASE}/craving?locale=en`)).json();
// term.definition(영어), term.body, term.advanced ...
```
- 자동 링크 로직은 중독뉴스 main.js 의 linkifyTerms() 를 그대로 이식 가능
  (link-map 이 동일 형식이므로).

### 방식 B) 독립 백과 코너
Lab 안에 백과 목록·상세를 그대로 임베드.
- encyclopedia.js 의 renderList/renderDetail 을 Lab 에 이식하고 API_BASE 만 교체.
- locale 은 Lab 의 언어 설정(ko/en)에 연동: isEn() 대신 Lab 의 i18n 상태 사용.

## 4. 영어 우선(글로벌) 시나리오
Lab 이 글로벌 SaaS 로 영어가 기본이라면, 호출 시 항상 `?locale=en` 을 붙이면 된다.
표제어도 termEn 을 쓰면 완전한 영어 화면이 된다. 한국어 데이터는 그대로 두고
locale 로만 전환하므로, 한 API 로 양쪽 시장을 모두 커버한다.

## 5. 주의
- Lab 이 백과를 "복제"하지 말 것. 항상 API 로 참조해야 172항목이 한 곳(중독뉴스 DB)에서
  관리되고, 선생님이 편집 화면에서 다듬은 내용이 Lab 에도 즉시 반영된다.
- 영상(videoUrl)도 같은 원리: 중독뉴스에 올린 MP4 경로를 Lab 이 그대로 참조.
- 배포 시 DB 접속정보·ADMIN_PASSWORD 는 환경변수로(레포에 넣지 말 것).
