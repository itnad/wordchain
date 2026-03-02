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

  const { requiredChars, usedWords = [], allowPersonNames, allowPlaceNames } = req.body;

  // Supabase 캐시에서 후보 탐색
  let query = supabase
    .from('words')
    .select('word, first_char, last_char, is_person_name, is_place_name')
    .eq('is_valid', true)
    .in('first_char', requiredChars)
    .limit(100);

  if (!allowPersonNames) query = query.eq('is_person_name', false);
  if (!allowPlaceNames)  query = query.eq('is_place_name', false);

  const { data: candidates } = await query;
  const usedSet = new Set(usedWords);
  const available = (candidates || []).filter(c => !usedSet.has(c.word));

  if (available.length > 0) {
    const chosen = available[Math.floor(Math.random() * available.length)];
    return res.json({ word: chosen.word, fromCache: true });
  }

  // Gemini에게 단어 생성 요청 (최대 2회 시도)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const usedList = usedWords.length > 0
        ? usedWords.slice(-30).join(', ')
        : '없음';

      const prompt = `끝말잇기 게임 AI 플레이어입니다. 다음 조건을 모두 만족하는 단어를 하나 골라주세요.

조건:
- 시작 글자: "${requiredChars.join('" 또는 "')}" 중 정확히 하나로 시작
- 글자 수: 정확히 3글자
- 품사: 명사 (표준국어대사전 기준, 전문용어/합성어 포함)
- 사람 이름 허용: ${allowPersonNames ? '예' : '아니오'}
- 지명 허용: ${allowPlaceNames ? '예' : '아니오'}
- 반드시 제외할 단어: ${usedList}

반드시 아래 JSON 형식으로만 응답하세요:
{"word":"단어","is_person_name":false,"is_place_name":false}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      let parsed;
      try {
        const match = text.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : text);
      } catch {
        continue;
      }

      const aiWord = parsed.word?.trim();
      if (!aiWord) continue;

      const wordChars = [...aiWord];
      if (wordChars.length !== 3) continue;
      if (!wordChars.every(c => /[가-힣]/.test(c))) continue;
      if (usedSet.has(aiWord)) continue;
      if (!requiredChars.includes(wordChars[0])) continue;

      const firstChar = wordChars[0];
      const lastChar  = wordChars[wordChars.length - 1];

      // Supabase 저장
      await supabase.from('words').upsert({
        word: aiWord,
        is_valid: true,
        is_person_name: !!parsed.is_person_name,
        is_place_name: !!parsed.is_place_name,
        first_char: firstChar,
        last_char: lastChar,
      }, { onConflict: 'word' });

      return res.json({ word: aiWord, fromCache: false });
    } catch (err) {
      console.error(`ai-turn attempt ${attempt + 1} error:`, err);
    }
  }

  return res.json({ word: null, surrender: true });
}
