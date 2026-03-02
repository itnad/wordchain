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

  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id가 필요합니다.' });

  const { data: player } = await supabase
    .from('players')
    .select('nickname, display_name')
    .eq('session_id', session_id)
    .maybeSingle();

  if (!player) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

  const { data, error } = await supabase
    .from('game_sessions')
    .insert({
      session_id,
      nickname:     player.nickname,
      display_name: player.display_name,
    })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ game_id: data.id });
}
