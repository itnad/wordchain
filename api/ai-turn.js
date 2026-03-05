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

  const { requiredChars, usedWords = [], allowPersonNames, allowPlaceNames } = req.body;

  try {
    // 첫 수 (requiredChars가 비어있음): RPC 우회 후 랜덤 단어 직접 조회
    if (!requiredChars || requiredChars.length === 0) {
      const { count } = await supabase
        .from('words')
        .select('*', { count: 'exact', head: true })
        .eq('is_valid', true)
        .eq('is_person_name', false)
        .eq('is_place_name', false);

      if (!count) return res.json({ word: null, surrender: true });

      const offset = Math.floor(Math.random() * count);
      const { data: firstData, error: firstError } = await supabase
        .from('words')
        .select('word, first_char, last_char')
        .eq('is_valid', true)
        .eq('is_person_name', false)
        .eq('is_place_name', false)
        .range(offset, offset);

      if (firstError || !firstData?.length) return res.json({ word: null, surrender: true });
      return res.json({ word: firstData[0].word, fromCache: true });
    }

    // 이후 수: 기존 RPC 사용
    const { data, error } = await supabase.rpc('get_random_ai_word', {
      p_required_chars: requiredChars,
      p_used_words:     usedWords,
      p_allow_person:   !!allowPersonNames,
      p_allow_place:    !!allowPlaceNames,
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
