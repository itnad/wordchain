/**
 * 표준국어대사전 OpenAPI를 이용한 초기 단어 DB 수집 스크립트
 * 실행: node --env-file=../.env scripts/seed-words.js
 *
 * 주요 시작 글자별로 3글자 명사를 수집하여 Supabase에 bulk insert합니다.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STDICT_KEY = process.env.STDICT_KEY;

// 수집할 시작 글자 (자주 등장하는 끝말잇기 글자 위주)
const START_CHARS = [
  '가','나','다','라','마','바','사','아','자','차','카','타','파','하',
  '고','노','도','로','모','보','소','오','조','초','코','토','포','호',
  '구','누','두','루','무','부','수','우','주','추','쿠','투','푸','후',
  '기','니','디','리','미','비','시','이','지','치','키','티','피','히',
  '강','남','북','동','서','인','대','중','전','경','광','울','부','제',
  '학','과','문','사','국','민','공','기','연','생','정','신','교','시',
];

async function fetchWords(startChar, page = 1) {
  const url = new URL('https://stdict.korean.go.kr/api/search.do');
  url.searchParams.set('key', STDICT_KEY);
  url.searchParams.set('q', startChar);
  url.searchParams.set('type_search', 'start');  // 시작 글자로 검색
  url.searchParams.set('req_type', 'json');
  url.searchParams.set('num', '100');             // 한 번에 100개
  url.searchParams.set('start', String((page - 1) * 100 + 1));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.channel ?? {};
}

function parseItems(channel) {
  const rawItems = channel?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  return items;
}

function is3CharKorean(word) {
  const chars = [...word];
  return chars.length === 3 && chars.every(c => /[가-힣]/.test(c));
}

function extractWordInfo(item) {
  const word = item?.word?.trim() ?? '';
  if (!is3CharKorean(word)) return null;

  const senses = item?.sense_info ?? [];
  const senseArr = Array.isArray(senses) ? senses : [senses];
  const hasNoun = senseArr.some(s => s?.pos === '명사') || item?.pos === '명사';
  if (!hasNoun) return null;

  const cat = item?.cat ?? '';
  return {
    word,
    is_valid:       true,
    is_person_name: cat.includes('인명'),
    is_place_name:  ['지명','나라명','지역명'].some(k => cat.includes(k)),
    first_char:     [...word][0],
    last_char:      [...word][2],
    source:         'stdict',
  };
}

async function seedChar(char) {
  const words = [];
  let page = 1;

  while (true) {
    try {
      const channel = await fetchWords(char, page);
      const total   = parseInt(channel?.total ?? '0', 10);
      const items   = parseItems(channel);

      for (const item of items) {
        const info = extractWordInfo(item);
        if (info) words.push(info);
      }

      const fetched = (page - 1) * 100 + items.length;
      if (fetched >= total || items.length < 100) break;

      page++;
      await sleep(300); // rate limit 방지
    } catch (err) {
      console.error(`  [${char}] 오류 (page ${page}):`, err.message);
      break;
    }
  }

  return words;
}

async function upsertBatch(words) {
  if (words.length === 0) return;
  const { error } = await supabase.from('words').upsert(words, { onConflict: 'word' });
  if (error) console.error('  upsert 오류:', error.message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('표준국어대사전 단어 수집 시작...');
  console.log(`대상 글자 수: ${START_CHARS.length}개\n`);

  let total = 0;

  for (const char of START_CHARS) {
    process.stdout.write(`[${char}] 수집 중... `);
    const words = await seedChar(char);
    await upsertBatch(words);
    total += words.length;
    console.log(`${words.length}개 저장 (누적: ${total}개)`);
    await sleep(500);
  }

  console.log(`\n완료! 총 ${total}개 단어 수집.`);
}

main().catch(console.error);
