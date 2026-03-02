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

  const { word, sessionId, nickname, gameId } = req.body;
  if (!word) return res.status(400).json({ error: 'word required' });

  const { error } = await supabase.from('word_challenges').insert({
    word:       word.trim(),
    session_id: sessionId ?? null,
    nickname:   nickname  ?? null,
    game_id:    gameId    ?? null,
  });

  if (error) {
    console.error('challenge error:', error);
    return res.status(500).json({ success: false });
  }

  return res.json({ success: true });
}
