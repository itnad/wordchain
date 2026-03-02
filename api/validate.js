import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STDICT_KEY = process.env.STDICT_KEY;
const NOT_IN_DICT_MSG =
  '사전에 등록되지 않은 단어입니다. 신조어이거나 아직 표준국어대사전에 ' +
  '등재되지 않은 단어일 가능성이 있으며, 추후 검토를 통해 허용 여부가 ' +
  '결정될 수 있습니다. 현재는 오답으로 처리됩니다.';

async function checkStdict(word) {
  const url = new URL('https://stdict.korean.go.kr/api/search.do');
  url.searchParams.set('key', STDICT_KEY);
  url.searchParams.set('q', word);
  url.searchParams.set('type_search', 'exact');
  url.searchParams.set('req_type', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`stdict HTTP ${res.status}`);

  const text = await res.text();
  if (!text || text.trim() === '') {
    return { isValid: false, isPersonName: false, isPlaceName: false };
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // XML 또는 빈 응답 → 미등재 단어로 처리
    return { isValid: false, isPersonName: false, isPlaceName: false };
  }

  const channel = json?.channel;
  const total = parseInt(channel?.total ?? '0', 10);

  if (total === 0) {
    return { isValid: false, isPersonName: false, isPlaceName: false };
  }

  const rawItems = channel?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  // 명사 여부: sense_info 배열 또는 직접 pos 필드 확인
  const hasNoun = items.some(item => {
    const senses = item?.sense_info ?? [];
    const senseArr = Array.isArray(senses) ? senses : [senses];
    const posFromSense = senseArr.some(s => s?.pos === '명사');
    const posFromItem = item?.pos === '명사';
    return posFromSense || posFromItem;
  });

  if (!hasNoun) {
    return { isValid: false, isPersonName: false, isPlaceName: false };
  }

  const isPersonName = items.some(item => {
    const cat = item?.cat ?? item?.word_info?.cat ?? '';
    return cat.includes('인명');
  });
  const isPlaceName = items.some(item => {
    const cat = item?.cat ?? item?.word_info?.cat ?? '';
    return ['지명', '나라명', '지역명'].some(k => cat.includes(k));
  });

  return { isValid: true, isPersonName, isPlaceName };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { word, allowPersonNames, allowPlaceNames, sessionId, nickname, gameId } = req.body;
  if (!word) return res.json({ valid: false, reason: '단어를 입력해주세요.' });

  const trimmed = word.trim();
  const chars = [...trimmed];

  if (chars.length !== 3) {
    return res.json({ valid: false, reason: '정확히 3글자 단어만 허용됩니다.' });
  }
  if (!chars.every(c => /[가-힣]/.test(c))) {
    return res.json({ valid: false, reason: '한글 단어만 허용됩니다.' });
  }

  const firstChar = chars[0];
  const lastChar  = chars[chars.length - 1];

  // 1. Supabase 캐시 확인
  const { data: cached } = await supabase
    .from('words')
    .select('*')
    .eq('word', trimmed)
    .maybeSingle();

  if (cached) {
    if (!cached.is_valid) {
      await logRejected(trimmed, sessionId, nickname, gameId, 'not_in_dict');
      return res.json({ valid: false, reason: NOT_IN_DICT_MSG });
    }
    if (!allowPersonNames && cached.is_person_name) {
      return res.json({ valid: false, reason: '사람 이름은 현재 허용되지 않습니다.' });
    }
    if (!allowPlaceNames && cached.is_place_name) {
      return res.json({ valid: false, reason: '지명은 현재 허용되지 않습니다.' });
    }
    return res.json({ valid: true, word: trimmed, fromCache: true });
  }

  // 2. 표준국어대사전 API 확인
  try {
    const result = await checkStdict(trimmed);

    await supabase.from('words').upsert({
      word: trimmed,
      is_valid: result.isValid,
      is_person_name: result.isPersonName,
      is_place_name: result.isPlaceName,
      first_char: firstChar,
      last_char: lastChar,
      source: 'stdict',
    }, { onConflict: 'word' });

    if (!result.isValid) {
      await logRejected(trimmed, sessionId, nickname, gameId, 'not_in_dict');
      return res.json({ valid: false, reason: NOT_IN_DICT_MSG });
    }
    if (!allowPersonNames && result.isPersonName) {
      return res.json({ valid: false, reason: '사람 이름은 현재 허용되지 않습니다.' });
    }
    if (!allowPlaceNames && result.isPlaceName) {
      return res.json({ valid: false, reason: '지명은 현재 허용되지 않습니다.' });
    }

    return res.json({ valid: true, word: trimmed, fromCache: false });

  } catch (err) {
    console.error('validate error:', err);
    return res.status(503).json({
      valid: false,
      reason: '단어 검증 서비스에 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    });
  }
}

async function logRejected(word, sessionId, nickname, gameId, reason) {
  try {
    await supabase.from('rejected_words_log').insert({
      word,
      session_id: sessionId ?? null,
      nickname:   nickname ?? null,
      game_id:    gameId ?? null,
      reason,
    });
  } catch (e) {
    console.error('logRejected error:', e);
  }
}
