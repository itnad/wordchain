import { createClient } from '@supabase/supabase-js';

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

  const { requiredChars, usedWords = [], allowPersonNames, allowPlaceNames, hellMode } = req.body;

  try {
    // 이의제기 중인 단어 목록 조회 (pending 상태)
    const { data: challengedData } = await supabase
      .from('word_challenges')
      .select('word')
      .eq('status', 'pending');
    const challengedWords = new Set(challengedData?.map(c => c.word) ?? []);
    const allExcluded = [...new Set([...usedWords, ...challengedWords])];

    // 첫 수 (requiredChars가 비어있음): 직접 조회
    if (!requiredChars || requiredChars.length === 0) {
      // 헬 모드: 필살/희귀 단어 우선 시도
      if (hellMode) {
        const { count: hellCount } = await supabase
          .from('words')
          .select('*', { count: 'exact', head: true })
          .eq('is_valid', true)
          .eq('is_person_name', false)
          .eq('is_place_name', false)
          .not('killer_score', 'is', null);

        if (hellCount && hellCount > 0) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const offset = Math.floor(Math.random() * hellCount);
            const { data } = await supabase
              .from('words')
              .select('word, first_char, last_char')
              .eq('is_valid', true)
              .eq('is_person_name', false)
              .eq('is_place_name', false)
              .not('killer_score', 'is', null)
              .range(offset, offset);
            if (data?.length && !challengedWords.has(data[0].word)) {
              return res.json({ word: data[0].word, fromCache: true });
            }
          }
        }
      }

      // 일반 랜덤 선택 (헬 모드 폴백 포함)
      const { count } = await supabase
        .from('words')
        .select('*', { count: 'exact', head: true })
        .eq('is_valid', true)
        .eq('is_person_name', false)
        .eq('is_place_name', false);

      if (!count) return res.json({ word: null, surrender: true });

      for (let attempt = 0; attempt < 3; attempt++) {
        const offset = Math.floor(Math.random() * count);
        const { data, error } = await supabase
          .from('words')
          .select('word, first_char, last_char')
          .eq('is_valid', true)
          .eq('is_person_name', false)
          .eq('is_place_name', false)
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
      return res.json({ word: null, surrender: true });
    }

    return res.json({ word: data[0].word, fromCache: true });

  } catch (err) {
    console.error('ai-turn error:', err);
    return res.json({ word: null, surrender: true });
  }
}
