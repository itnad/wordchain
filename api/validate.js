import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { word, allowPersonNames, allowPlaceNames } = req.body;
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

  // 캐시 확인
  const { data: cached } = await supabase
    .from('words')
    .select('*')
    .eq('word', trimmed)
    .maybeSingle();

  if (cached) {
    if (!cached.is_valid) {
      return res.json({ valid: false, reason: '표준국어대사전에 없는 단어입니다.' });
    }
    if (!allowPersonNames && cached.is_person_name) {
      return res.json({ valid: false, reason: '사람 이름은 현재 허용되지 않습니다.' });
    }
    if (!allowPlaceNames && cached.is_place_name) {
      return res.json({ valid: false, reason: '지명은 현재 허용되지 않습니다.' });
    }
    return res.json({ valid: true, word: trimmed, fromCache: true });
  }

  // Gemini 검증
  try {
    const prompt = `한국어 끝말잇기 단어 검증 전문가입니다.

단어 "${trimmed}"를 판단해주세요:
1. 표준국어대사전에 등재된 명사이거나 등재될 만한 일반 명사인가? (전문용어, 합성어, 외래어 명사 포함)
2. 사람 이름인가? (실존 인물 또는 소설 등의 고유명사)
3. 지명인가? (국내외 지역, 도시, 산, 강, 나라 이름 등)

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이:
{"is_valid":true,"is_person_name":false,"is_place_name":false,"reason":"이유"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      return res.status(500).json({ valid: false, reason: '검증 처리 중 오류가 발생했습니다.' });
    }

    // Supabase 저장
    await supabase.from('words').upsert({
      word: trimmed,
      is_valid: !!parsed.is_valid,
      is_person_name: !!parsed.is_person_name,
      is_place_name: !!parsed.is_place_name,
      first_char: firstChar,
      last_char: lastChar,
    }, { onConflict: 'word' });

    if (!parsed.is_valid) {
      return res.json({ valid: false, reason: parsed.reason || '표준국어대사전에 없는 단어입니다.' });
    }
    if (!allowPersonNames && parsed.is_person_name) {
      return res.json({ valid: false, reason: '사람 이름은 현재 허용되지 않습니다.' });
    }
    if (!allowPlaceNames && parsed.is_place_name) {
      return res.json({ valid: false, reason: '지명은 현재 허용되지 않습니다.' });
    }

    return res.json({ valid: true, word: trimmed, fromCache: false });
  } catch (err) {
    console.error('validate error:', err);
    return res.status(500).json({ valid: false, reason: 'AI 검증 서비스 오류가 발생했습니다.' });
  }
}
