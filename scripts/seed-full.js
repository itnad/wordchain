/**
 * 표준국어대사전 전체 3글자 명사 대규모 수집 스크립트
 *
 * 실행: node --env-file=.env scripts/seed-full.js
 *
 * - 가-힣 전체 11,172개 음절을 시작 글자로 사용
 * - 3글자 한글 명사만 필터링
 * - 체크포인트 지원 (중단 후 재시작 가능)
 * - 예상 소요시간: 10~20분
 * - 예상 수집량: 20,000~40,000개
 */

import { createClient }          from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const STDICT_KEY   = process.env.STDICT_KEY;
const CONCURRENCY  = 5;    // 동시 요청 수 (높이면 빠르지만 API 부하)
const DELAY_MS     = 120;  // 배치 간 대기시간(ms)
const UPSERT_SIZE  = 500;  // Supabase 일괄 저장 단위
const CHECKPOINT   = 'scripts/.seed-full-checkpoint.json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 가(0xAC00) ~ 힣(0xD7A3): 한국어 전체 음절 11,172개
function allSyllables() {
  const list = [];
  for (let code = 0xAC00; code <= 0xD7A3; code++) {
    list.push(String.fromCharCode(code));
  }
  return list;
}

async function fetchPage(syllable, start = 1) {
  const url = new URL('https://stdict.korean.go.kr/api/search.do');
  url.searchParams.set('key',         STDICT_KEY);
  url.searchParams.set('q',           syllable);
  url.searchParams.set('type_search', 'start');
  url.searchParams.set('req_type',    'json');
  url.searchParams.set('num',         '100');
  url.searchParams.set('start',       String(start));

  const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  if (!text || text.trim() === '') return { total: 0, items: [] };

  let json;
  try { json = JSON.parse(text); } catch { return { total: 0, items: [] }; }

  const channel = json?.channel;
  const total   = parseInt(channel?.total ?? '0', 10);
  const raw     = channel?.item ?? [];
  const items   = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return { total, items };
}

function extractWordInfo(item) {
  // stdict 응답에 표기 기호(^, ~, - 등)가 섞이는 경우 제거
  const raw   = item?.word ?? '';
  const word  = raw.replace(/[\^~\-\s]/g, '').replace(/[0-9]/g, '');
  const chars = [...word];

  if (chars.length !== 3) return null;
  if (!chars.every(c => /[가-힣]/.test(c))) return null;

  // 명사 여부 확인
  const senses   = item?.sense_info ?? [];
  const senseArr = Array.isArray(senses) ? senses : [senses];
  const hasNoun  = senseArr.some(s => s?.pos === '명사') || item?.pos === '명사';
  if (!hasNoun) return null;

  const cat = item?.cat ?? '';
  return {
    word,
    is_valid:       true,
    is_person_name: cat.includes('인명'),
    is_place_name:  ['지명', '나라명', '지역명'].some(k => cat.includes(k)),
    first_char:     chars[0],
    last_char:      chars[2],
    source:         'stdict',
  };
}

async function collectSyllable(syllable) {
  const words = [];
  let start   = 1;
  let total   = 0;
  let retries = 0;

  do {
    try {
      const page = await fetchPage(syllable, start);
      total = page.total;

      for (const item of page.items) {
        const info = extractWordInfo(item);
        if (info) words.push(info);
      }

      if (page.items.length < 100) break; // 마지막 페이지
      start  += 100;
      retries = 0;
    } catch {
      retries++;
      if (retries >= 3) break;
      await sleep(500);
    }
  } while (start <= total);

  return words;
}

async function upsertBatch(words) {
  if (words.length === 0) return;
  const { error } = await supabase.from('words').upsert(words, { onConflict: 'word' });
  if (error) console.error('\n  upsert 오류:', error.message);
}

async function main() {
  if (!STDICT_KEY) {
    console.error('STDICT_KEY 환경변수가 없습니다. .env 파일을 확인하세요.');
    process.exit(1);
  }

  const allList = allSyllables();

  // 체크포인트 불러오기 (중단 후 재시작 지원)
  let checkpoint = { done: [], totalInserted: 0 };
  if (existsSync(CHECKPOINT)) {
    try {
      checkpoint = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
      console.log(`체크포인트 발견: ${checkpoint.done.length}개 음절 완료, ${checkpoint.totalInserted}개 저장됨`);
    } catch { /* 무시 */ }
  }

  const doneSet    = new Set(checkpoint.done);
  const remaining  = allList.filter(s => !doneSet.has(s));
  let   totalSaved = checkpoint.totalInserted;
  const buffer     = [];

  console.log(`\n표준국어대사전 전체 3글자 명사 수집`);
  console.log(`전체 음절: ${allList.length}개 | 남은 음절: ${remaining.length}개`);
  console.log(`동시 요청: ${CONCURRENCY}개 | 예상 소요: ${Math.ceil(remaining.length / CONCURRENCY * (DELAY_MS + 400) / 60000)}분\n`);

  const startTime = Date.now();
  let   processed = 0;

  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);

    // 병렬 수집
    const results = await Promise.all(batch.map(s => collectSyllable(s)));
    const words   = results.flat();
    buffer.push(...words);
    processed += batch.length;

    // 체크포인트 갱신
    for (const s of batch) checkpoint.done.push(s);

    // 일정 수 모이면 Supabase에 저장
    if (buffer.length >= UPSERT_SIZE) {
      await upsertBatch([...buffer]);
      totalSaved += buffer.length;
      buffer.length = 0;
      checkpoint.totalInserted = totalSaved;
      writeFileSync(CHECKPOINT, JSON.stringify(checkpoint));
    }

    // 진행 표시
    const pct     = ((processed / remaining.length) * 100).toFixed(1);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta     = processed > 0
      ? Math.round(elapsed / processed * (remaining.length - processed))
      : 0;
    process.stdout.write(
      `\r진행: ${processed}/${remaining.length} (${pct}%) | 저장: ${totalSaved + buffer.length}개 | 경과: ${elapsed}s | 남은시간: ~${eta}s   `
    );

    await sleep(DELAY_MS);
  }

  // 버퍼에 남은 단어 저장
  if (buffer.length > 0) {
    await upsertBatch(buffer);
    totalSaved += buffer.length;
  }

  // 체크포인트 삭제
  try { unlinkSync(CHECKPOINT); } catch { /* 무시 */ }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n\n완료! 총 ${totalSaved}개 단어 수집 (소요: ${elapsed}초)`);
}

main().catch(console.error);
