-- ============================================================
-- 끝말잇기 v2 DB 마이그레이션
-- Supabase SQL Editor에서 순서대로 실행하세요
-- ============================================================

-- 1. 기존 words 테이블 컬럼 추가
ALTER TABLE words
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'stdict',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- 2. nickname_words 테이블 (닉네임 생성용 단어)
-- ============================================================
CREATE TABLE IF NOT EXISTS nickname_words (
  id    SERIAL PRIMARY KEY,
  word  TEXT NOT NULL UNIQUE,
  type  TEXT NOT NULL CHECK (type IN ('adjective', 'place'))
);

INSERT INTO nickname_words (word, type) VALUES
  -- 형용사 (30개)
  ('촉촉한',      'adjective'),
  ('고독한',      'adjective'),
  ('허무한',      'adjective'),
  ('어리바리한',  'adjective'),
  ('꼬질꼬질한',  'adjective'),
  ('삐딱한',      'adjective'),
  ('발랄한',      'adjective'),
  ('나른한',      'adjective'),
  ('몽롱한',      'adjective'),
  ('엉뚱한',      'adjective'),
  ('소심한',      'adjective'),
  ('짓궂은',      'adjective'),
  ('야릇한',      'adjective'),
  ('두근거리는',  'adjective'),
  ('떨떠름한',    'adjective'),
  ('멍청한',      'adjective'),
  ('능청스러운',  'adjective'),
  ('뻔뻔한',      'adjective'),
  ('수줍은',      'adjective'),
  ('까다로운',    'adjective'),
  ('느긋한',      'adjective'),
  ('덜렁대는',    'adjective'),
  ('새침한',      'adjective'),
  ('투덜대는',    'adjective'),
  ('호들갑스러운','adjective'),
  ('의젓한',      'adjective'),
  ('수상한',      'adjective'),
  ('어설픈',      'adjective'),
  ('허당스러운',  'adjective'),
  ('엄살스러운',  'adjective'),
  -- 지명/신체 (25개)
  ('독도',        'place'),
  ('한라산',      'place'),
  ('낙동강',      'place'),
  ('겨드랑이',    'place'),
  ('무릎',        'place'),
  ('배꼽',        'place'),
  ('콧구멍',      'place'),
  ('귓불',        'place'),
  ('발가락',      'place'),
  ('소양호',      'place'),
  ('제주',        'place'),
  ('여수',        'place'),
  ('통영',        'place'),
  ('강릉',        'place'),
  ('동해',        'place'),
  ('설악산',      'place'),
  ('지리산',      'place'),
  ('남산',        'place'),
  ('한강',        'place'),
  ('뒤통수',      'place'),
  ('명치',        'place'),
  ('복숭아뼈',    'place'),
  ('백두산',      'place'),
  ('울릉도',      'place'),
  ('거제도',      'place')
ON CONFLICT (word) DO NOTHING;

-- ============================================================
-- 3. players 테이블 (세션/플레이어 정보)
-- ============================================================
CREATE TABLE IF NOT EXISTS players (
  session_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  nickname     TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. game_sessions 테이블 (게임 기록)
-- ============================================================
CREATE TABLE IF NOT EXISTS game_sessions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES players(session_id),
  nickname          TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  result            TEXT CHECK (result IN ('player_win', 'ai_win', 'abandoned')),
  player_word_count INT DEFAULT 0,
  total_turns       INT DEFAULT 0,
  word_history      JSONB DEFAULT '[]'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_gs_session  ON game_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_gs_ranking  ON game_sessions(started_at DESC, player_word_count DESC)
  WHERE result = 'player_win';

-- ============================================================
-- 5. rejected_words_log 테이블 (오답 기록)
-- ============================================================
CREATE TABLE IF NOT EXISTS rejected_words_log (
  id          BIGSERIAL PRIMARY KEY,
  word        TEXT NOT NULL,
  session_id  TEXT,
  nickname    TEXT,
  rejected_at TIMESTAMPTZ DEFAULT NOW(),
  reason      TEXT,
  game_id     UUID REFERENCES game_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_rwl_word ON rejected_words_log(word);
CREATE INDEX IF NOT EXISTS idx_rwl_time ON rejected_words_log(rejected_at DESC);

-- ============================================================
-- 6. 관리자용 집계 뷰
-- ============================================================
CREATE OR REPLACE VIEW rejected_words_summary AS
SELECT
  rwl.word,
  COUNT(*)             AS reject_count,
  MAX(rwl.rejected_at) AS last_rejected_at,
  (SELECT w.is_valid FROM words w WHERE w.word = rwl.word LIMIT 1) AS already_decided
FROM rejected_words_log rwl
WHERE rwl.reason = 'not_in_dict'
GROUP BY rwl.word
ORDER BY reject_count DESC, last_rejected_at DESC;

-- ============================================================
-- 8. 이의 제기 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS word_challenges (
  id             BIGSERIAL PRIMARY KEY,
  word           TEXT NOT NULL,
  session_id     TEXT,
  nickname       TEXT,
  game_id        UUID,   -- game_sessions(id) 참조 (soft)
  challenged_at  TIMESTAMPTZ DEFAULT NOW(),
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_wc_word   ON word_challenges(word);
CREATE INDEX IF NOT EXISTS idx_wc_status ON word_challenges(status, challenged_at DESC);

-- ============================================================
-- 7. AI 랜덤 단어 선택 RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_random_ai_word(
  p_required_chars TEXT[],
  p_used_words     TEXT[],
  p_allow_person   BOOLEAN DEFAULT FALSE,
  p_allow_place    BOOLEAN DEFAULT FALSE,
  p_hell_mode      BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(word TEXT, first_char TEXT, last_char TEXT)
LANGUAGE sql STABLE AS $$
  SELECT w.word, w.first_char, w.last_char
  FROM words w
  WHERE w.is_valid = TRUE
    AND (cardinality(p_required_chars) = 0 OR w.first_char = ANY(p_required_chars))
    AND NOT (w.word = ANY(p_used_words))
    AND (p_allow_person OR NOT w.is_person_name)
    AND (p_allow_place  OR NOT w.is_place_name)
  ORDER BY
    CASE WHEN p_hell_mode THEN COALESCE(w.killer_score, 999) ELSE 9999 END ASC,
    RANDOM()
  LIMIT 1;
$$;
-- 헬 모드: killer_score ASC (0=필살단어 우선 → 1~3=희귀단어 → NULL=일반단어)
-- 일반 모드: COALESCE 결과가 9999로 동일하므로 RANDOM() 만 유효

-- ============================================================
-- 8. words 테이블 killer_score 컬럼 추가
-- ============================================================
ALTER TABLE words
  ADD COLUMN IF NOT EXISTS killer_score SMALLINT DEFAULT NULL;

-- 컬럼 코멘트
COMMENT ON COLUMN words.killer_score IS
  '필살/희귀 점수. NULL=일반단어, 0=필살단어(이어지는 단어 없음), 1~3=희귀단어(이어지는 단어 수)';
