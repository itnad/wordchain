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
