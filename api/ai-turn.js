import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findWordWithGemini(requiredChars, usedWords, allowPersonNames, allowPlaceNames) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  // 첫 수처럼 시작 글자 제약이 없을 때는 임의로 한 번만 시도
  const targets = requiredChars.length > 0 ? requiredChars : [null];

  for (const startChar of targets) {
    const restrictions = [];
    if (!allowPersonNames) restrictions.push('사람 이름 제외');
    if (!allowPlaceNames) restrictions.push('지명 제외');

    const lines = [
      `끝말잇기 게임에서 사용할 수 있는 한국어 3글자 명사를 하나만 알려주세요.`,
      `조건:`,
      ...(startChar ? [`- 반드시 "${startChar}"으로 시작하는 단어`] : []),
      `- 정확히 3글자`,
      `- 표준국어대사전에 등재된 일반 명사`,
    ];
    if (restrictions.length > 0) lines.push(`- ${restrictions.join(', ')}`);
    if (usedWords.length > 0) lines.push(`- 이미 사용된 단어(사용 불가): ${usedWords.join(', ')}`);
    lines.push(`- 단어만 출력 (설명 없이)`);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: lines.join('\n') }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
          }),
        }
      );

      if (!response.ok) continue;

      const json = await response.json();
      const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      const word = raw.split('\n')[0].trim();

      const wordChars = [...word];
      if (wordChars.length !== 3) continue;
      if (!wordChars.every(c => /[가-힣]/.test(c))) continue;
      if (startChar && wordChars[0] !== startChar) continue;
      if (usedWords.includes(word)) continue;

      return { word, firstChar: wordChars[0], lastChar: wordChars[2] };
    } catch (e) {
      console.error('Gemini API error:', e);
    }
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { requiredChars, usedWords = [], allowPersonNames, allowPlaceNames, hellMode } = req.body;

  try {
    // 이의제기 중인 단어 목록 조회 (pending 상태)
    const { data: challengedData } = await supabase
      .from('word_challenges')
      .select('word')
      .eq('status', 'pending');
    const challengedWords = new Set(challengedData?.map(c => c.word) ?? []);
    const allExcluded = [...new Set([...usedWords, ...challengedWords])];

    // 첫 수 (requiredChars가 비어있음): 모드 무관하게 일반 단어로 시작
    if (!requiredChars || requiredChars.length === 0) {
      // 난이도 낮은 단어(killer_score IS NULL) 선택
      const { count } = await supabase
        .from('words')
        .select('*', { count: 'exact', head: true })
        .eq('is_valid', true)
        .eq('is_person_name', false)
        .eq('is_place_name', false)
        .is('killer_score', null);

      if (!count) return res.json({ word: null, surrender: true });

      for (let attempt = 0; attempt < 3; attempt++) {
        const offset = Math.floor(Math.random() * count);
        const { data, error } = await supabase
          .from('words')
          .select('word, first_char, last_char')
          .eq('is_valid', true)
          .eq('is_person_name', false)
          .eq('is_place_name', false)
          .is('killer_score', null)
          .range(offset, offset);
        if (!error && data?.length && !challengedWords.has(data[0].word)) {
          return res.json({ word: data[0].word, fromCache: true });
        }
      }
      return res.json({ word: null, surrender: true });
    }

    // 이후 수: RPC 사용 (헬 모드 시 killer_score 우선 정렬)
    const { data, error } = await supabase.rpc('get_random_ai_word', {
      p_required_chars: requiredChars,
      p_used_words:     allExcluded,
      p_allow_person:   !!allowPersonNames,
      p_allow_place:    !!allowPlaceNames,
      p_hell_mode:      !!hellMode,
    });

    if (error) throw error;

    if (!data || data.length === 0) {
      // DB에 없으면 Gemini로 생성
      const geminiResult = await findWordWithGemini(requiredChars, allExcluded, allowPersonNames, allowPlaceNames);
      if (geminiResult) {
        await supabase.from('words').upsert({
          word:           geminiResult.word,
          is_valid:       true,
          is_person_name: false,
          is_place_name:  false,
          first_char:     geminiResult.firstChar,
          last_char:      geminiResult.lastChar,
          source:         'gemini',
        }, { onConflict: 'word' });
        return res.json({ word: geminiResult.word, fromGemini: true });
      }
      return res.json({ word: null, surrender: true });
    }

    return res.json({ word: data[0].word, fromCache: true });

  } catch (err) {
    console.error('ai-turn error:', err);
    return res.json({ word: null, surrender: true });
  }
}
