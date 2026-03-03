# Infinite Word Chain · 무한 끝말잇기

3글자 한국어 명사로 이어가는 끝말잇기 웹게임.
플레이어 vs AI 대전 / 솔로 챌린지 모드 지원.

- **배포**: Vercel (서울 리전 `icn1`) — GitHub main 브랜치 push 시 자동 배포
- **DB**: Supabase (단어 캐시, 게임 기록, 랭킹)
- **단어 검증**: 표준국어대사전 OpenAPI → Supabase DB 캐시

---

## 목차

1. [기술 스택](#기술-스택)
2. [화면 구성](#화면-구성)
3. [로컬 개발 환경 설정](#로컬-개발-환경-설정)
4. [환경변수](#환경변수)
5. [Supabase DB 설정](#supabase-db-설정)
6. [스크립트 사용법](#스크립트-사용법)
7. [API 엔드포인트](#api-엔드포인트)
8. [단어 검증 로직](#단어-검증-로직)
9. [배포](#배포)
10. [관리자 페이지](#관리자-페이지)

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | 바닐라 JS + HTML/CSS (프레임워크 없음) |
| 백엔드 API | Vercel Serverless Functions (Node.js ESM) |
| DB | Supabase (PostgreSQL) |
| 단어 검증 | 표준국어대사전 OpenAPI (국립국어원) |
| 호스팅 | Vercel (GitHub 연동 자동 배포) |

---

## 화면 구성

```
/ (index.html)
├── 닉네임 입력 화면    — 이름 입력 → 닉네임 자동 생성 미리보기
├── 게임 설정 화면      — 사람이름/지명 허용 여부 설정
└── 게임 화면          — 플레이어 vs AI 끝말잇기

/challenge.html        — 솔로 챌린지 (혼자 최대한 길게 이어가기)

/admin.html            — 관리자 페이지 (로그인 필요)
├── 오답 집계 탭       — 거부된 단어 목록 → 허용/거부 처리
├── 이의 제기 탭       — 플레이어 이의신청 목록 → 유지/제외 처리
└── 단어 입력 탭       — 체인 형식으로 단어 직접 DB 등록
```

### 닉네임 생성 규칙

세션 ID(UUID)의 hex 값 구간을 인덱스로 사용해 결정론적으로 생성:

```
형식: "[형용사] [지명/신체]의 [형용사] [이름]"
예시: "촉촉한 독도의 발랄한 철수"
```

localStorage에 `wc_session_id`, `wc_display_name`, `wc_nickname` 저장.

---

## 로컬 개발 환경 설정

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
# .env 파일을 열어 실제 키값 입력
```

### 3. 로컬 서버 실행

```bash
npm run local
# → http://localhost:3000 (포트 3000~3004 중 빈 포트 사용)
```

> `vercel dev` 기반. `.env` 파일이 자동으로 로드됩니다.
> `npm run dev`는 사용 금지 — Vercel이 재귀 호출하는 문제가 있음.

---

## 환경변수

`.env` / Vercel 프로젝트 환경변수에 모두 설정 필요.

| 변수명 | 설명 | 획득 방법 |
|--------|------|-----------|
| `STDICT_KEY` | 표준국어대사전 OpenAPI 키 | [국립국어원 OpenAPI](https://stdict.korean.go.kr/openapi/openApiInfo.do) |
| `ADMIN_PASSWORD` | 관리자 페이지 비밀번호 | 임의 설정 |
| `SUPABASE_URL` | Supabase 프로젝트 URL | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 | Supabase → Settings → API |

> `SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회하는 서버 전용 키입니다.
> 절대 클라이언트(브라우저)에 노출하지 마세요.

---

## Supabase DB 설정

Supabase 대시보드 → SQL Editor에서 `supabase/migrations.sql` 전체를 실행합니다.

### 테이블 구조

| 테이블 | 역할 |
|--------|------|
| `words` | 단어 캐시 (is_valid, is_person_name, is_place_name, first_char, last_char, source) |
| `nickname_words` | 닉네임 생성용 형용사/지명 단어 풀 |
| `players` | 세션별 플레이어 정보 (session_id PK, display_name, nickname) |
| `game_sessions` | 게임 기록 (결과, 턴수, 단어 이력 JSONB) |
| `rejected_words_log` | 오답 단어 로그 |
| `word_challenges` | 플레이어 이의 제기 기록 |
| `rejected_words_summary` | 오답 집계 뷰 (관리자용) |

### RPC 함수

```sql
get_random_ai_word(
  p_required_chars TEXT[],   -- 필수 시작 글자 목록 (두음법칙 포함)
  p_used_words     TEXT[],   -- 이미 사용된 단어 목록
  p_allow_person   BOOLEAN,
  p_allow_place    BOOLEAN
) RETURNS TABLE(word, first_char, last_char)
```

AI 차례에 DB에서 조건에 맞는 랜덤 단어를 반환합니다.

### words 테이블 source 값

| source | 의미 |
|--------|------|
| `stdict` | 표준국어대사전 API로 검증된 단어 |
| `manual` | 관리자가 직접 입력한 단어 |
| `unverified` | API 미접근 상태에서 임시 허용된 단어 |
| `embedded` | 초기 seed 스크립트로 삽입된 단어 |

---

## 스크립트 사용법

### 로컬 개발

```bash
npm run local        # vercel dev 실행 (http://localhost:3000)
```

### 배포

```bash
npm run deploy
# 내부 동작:
#   1. package.json version patch 증가 (1.0.0 → 1.0.1)
#   2. public/version.js 동기화
#   3. git commit (chore: vX.X.X)
#   4. git push origin main → Vercel 자동 배포
```

버전을 수동으로 지정하고 싶을 때는 `package.json`의 `version` 필드를 직접 수정한 후 `npm run deploy`를 실행하면 해당 버전을 기준으로 patch 증가합니다.

---

### 단어 DB 씨드 스크립트

#### `scripts/seed-full.js` — 대규모 전체 수집 (권장)

표준국어대사전의 **가-힣 전체 11,172개 음절**을 시작 글자로 사용해 3글자 명사를 수집합니다.

```bash
node --env-file=.env scripts/seed-full.js
```

| 항목 | 내용 |
|------|------|
| 예상 수집량 | 20,000 ~ 40,000개 |
| 예상 소요시간 | 10 ~ 20분 |
| 동시 요청 수 | 5개 (코드 내 `CONCURRENCY` 상수로 조정 가능) |
| 중단/재시작 | 체크포인트 파일(`scripts/.seed-full-checkpoint.json`) 자동 저장 → 재실행 시 이어서 진행 |

실행 중 화면:
```
표준국어대사전 전체 3글자 명사 수집
전체 음절: 11,172개 | 남은 음절: 11,172개
동시 요청: 5개 | 예상 소요: ~15분

진행: 3240/11172 (29.0%) | 저장: 8,420개 | 경과: 180s | 남은시간: ~440s
```

중간에 Ctrl+C로 중단해도 체크포인트가 유지됩니다. 다시 실행하면 중단된 지점부터 재개합니다.

#### `scripts/seed-words.js` — 부분 수집

주요 시작 글자(약 50개) 대상으로만 수집합니다. seed-full.js 실행 전 빠른 초기 데이터 확보용.

```bash
node --env-file=.env scripts/seed-words.js
```

예상 수집량: 3,000 ~ 5,000개 / 소요시간: 1~2분

#### `scripts/seed-embedded.js` — 내장 데이터 삽입

코드에 하드코딩된 약 500개 단어를 삽입합니다. API 없이도 실행 가능.

```bash
node --env-file=.env scripts/seed-embedded.js
```

#### `scripts/bump-version.js` — 버전 증가

`npm run deploy`에서 자동 호출됩니다. 직접 실행 시:

```bash
node scripts/bump-version.js
# package.json version patch 증가 + public/version.js 동기화 + git commit
```

---

## API 엔드포인트

모든 엔드포인트는 `/api/` 하위 Vercel Serverless Function입니다.

### 게임 플레이

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `POST /api/validate` | POST | 단어 유효성 검사 |
| `POST /api/ai-turn` | POST | AI 차례 단어 선택 |
| `GET /api/word-info?word=XXX` | GET | 단어 뜻 조회 |
| `POST /api/challenge` | POST | 단어 이의 제기 등록 |

#### `POST /api/validate`

```json
// 요청
{
  "word": "사과",
  "allowPersonNames": false,
  "allowPlaceNames": false,
  "sessionId": "uuid",
  "nickname": "철수",
  "gameId": "uuid"
}

// 응답 (성공)
{
  "valid": true,
  "word": "사과",
  "fromCache": true,
  "steps": [
    { "label": "DB", "ok": true, "detail": "유효한 단어(캐시됨)" }
  ]
}

// 응답 (실패)
{
  "valid": false,
  "reason": "사전에 등록되지 않은 단어입니다...",
  "steps": [...]
}
```

**단어 검증 흐름:**
```
입력 (3글자 한글 기본 검사)
  ↓
Supabase DB 조회 (캐시 확인)
  ├── is_valid=true  → 즉시 허용 반환
  ├── is_valid=false → 거부 반환 + 오답 로그 기록
  └── 없음          → 임시 허용 (source='unverified') 반환
```

> 표준국어대사전 API는 Vercel 서울 리전(AWS)에서 IP 차단됨.
> 로컬 seed 스크립트로 DB를 충분히 채우면 대부분의 단어가 캐시에서 즉시 응답.

#### `POST /api/ai-turn`

```json
// 요청
{
  "requiredChars": ["나", "라"],
  "usedWords": ["사과", "과자"],
  "allowPersonNames": false,
  "allowPlaceNames": false
}

// 응답
{ "word": "나라", "fromCache": true }
// 또는 단어를 찾지 못한 경우
{ "word": null, "surrender": true }
```

### 세션 / 기록

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `POST /api/session` | POST | 세션 등록 + 닉네임 생성 |
| `GET /api/nickname-words` | GET | 닉네임 생성용 단어 목록 |
| `POST /api/game-start` | POST | 게임 세션 시작 |
| `POST /api/game-end` | POST | 게임 세션 종료 + 개인 최고기록 |
| `GET /api/ranking` | GET | 오늘의 랭킹 TOP 10 |

### 관리자

| 엔드포인트 | 메서드 | action 값 |
|-----------|--------|-----------|
| `POST /api/admin` | POST | `list` / `approve` / `reject` / `add-word` / `list-challenges` / `challenge-uphold` / `challenge-dismiss` |

```json
// 공통 요청 형식
{
  "password": "관리자비밀번호",
  "action": "approve",
  "word": "사과나무"
}
```

| action | 동작 |
|--------|------|
| `list` | 오답 집계 목록 반환 |
| `approve` | 단어를 `is_valid=true`로 저장 |
| `reject` | 단어를 `is_valid=false`로 저장 |
| `add-word` | 단어를 `is_valid=true, source='manual'`로 직접 삽입 |
| `list-challenges` | 이의 제기 목록 반환 |
| `challenge-uphold` | 이의 인정 → 단어 `is_valid=false` 처리 |
| `challenge-dismiss` | 이의 기각 → 단어 유지 |

---

## 단어 검증 로직

### 기본 규칙

- 정확히 **3글자** 한국어
- 전부 **한글 음절** (가-힣)
- 이미 사용된 단어 재사용 불가

### 두음법칙

마지막 글자의 초성이 `ㄹ` 또는 `ㄴ`(+이모음)인 경우 대체 글자를 추가로 허용.

```
예: "낙동강" → 마지막 글자 "강"
    "강"으로 시작하는 단어 허용

예: "나일론" → 마지막 글자 "론"
    "론" 또는 두음법칙 적용 "논"으로 시작하는 단어 허용
```

### AI 전략

DB의 `words` 테이블에서 `is_valid=true`인 단어 중 조건에 맞는 것을 랜덤 선택 (`get_random_ai_word` RPC). 조건에 맞는 단어가 없으면 항복(`surrender: true`).

---

## 배포

### 자동 배포 (권장)

```bash
npm run deploy
```

main 브랜치에 push되면 Vercel이 자동으로 빌드 및 배포합니다.

### 수동 배포

```bash
git add .
git commit -m "your message"
git push origin main
```

### Vercel 설정 (`vercel.json`)

```json
{
  "framework": null,
  "devCommand": null,
  "outputDirectory": "public",
  "regions": ["icn1"]
}
```

- `regions: ["icn1"]` — 서울 리전 강제 지정 (표준국어대사전 API 지연 최소화 목적으로 설정했으나, AWS 인프라 사용으로 인해 해당 API는 Vercel에서 호출 불가)
- `outputDirectory: "public"` — 정적 파일 서빙 디렉터리

---

## 관리자 페이지

URL: `/admin.html`

### 로그인

`ADMIN_PASSWORD` 환경변수에 설정한 비밀번호로 로그인.

### 탭 기능

#### 오답 집계

플레이어가 입력했다가 거부된 단어들의 집계. 동일한 단어가 여러 번 거부될수록 상위 노출.

- **허용**: `is_valid=true, source='manual'`로 저장 (이후 DB 캐시에서 바로 통과)
- **거부**: `is_valid=false, source='manual'`로 저장 (이후 DB 캐시에서 바로 거부)

#### 이의 제기

플레이어가 게임 중 `?` 버튼 → "이의 제기"로 신청한 단어 목록.

- **유지**: 이의 기각, 단어 그대로 사용
- **제외**: 이의 인정, `is_valid=false` 처리

#### 단어 입력

관리자가 직접 체인 형식으로 단어를 입력해 DB에 등록.

- 끝말잇기 체인 규칙 적용 (두음법칙 포함)
- 검증 없이 즉시 `is_valid=true, source='manual'`로 저장
- 이번 세션 추가한 단어 수 카운터 표시
- 잘못된 단어를 입력하면 에러만 표시 (게임 오버 없음, 수정 후 재입력 가능)

---

## 알려진 제약사항

| 항목 | 내용 |
|------|------|
| 표준국어대사전 API | Vercel(AWS) IP에서 TCP 레벨 차단됨 (ECONNRESET). 로컬에서는 정상 동작. |
| 단어 검증 | DB에 없는 단어는 임시 허용(`source='unverified'`). seed 스크립트로 DB를 채울수록 정확도 향상. |
| Vercel 콜드 스타트 | 일정 시간 미사용 시 첫 요청에 2~4초 추가 소요 (서버리스 구조 특성). |
| AI 단어 고갈 | DB 단어 수가 적으면 AI가 조건에 맞는 단어를 찾지 못해 항복할 수 있음. seed-full.js 실행으로 해결. |
