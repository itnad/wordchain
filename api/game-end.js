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

  const { game_id, session_id, result, player_word_count, total_turns, word_history } = req.body;
  if (!game_id || !session_id) {
    return res.status(400).json({ error: 'game_id와 session_id가 필요합니다.' });
  }

  // 게임 종료 기록
  await supabase.from('game_sessions').update({
    ended_at:          new Date().toISOString(),
    result:            result ?? 'abandoned',
    player_word_count: player_word_count ?? 0,
    total_turns:       total_turns ?? 0,
    word_history:      word_history ?? [],
  }).eq('id', game_id);

  // 개인 최고기록 조회
  const { data: best } = await supabase
    .from('game_sessions')
    .select('player_word_count')
    .eq('session_id', session_id)
    .eq('result', 'player_win')
    .order('player_word_count', { ascending: false })
    .limit(1)
    .maybeSingle();

  const personal_best  = best?.player_word_count ?? 0;
  const is_new_record  = result === 'player_win' && player_word_count >= personal_best;

  return res.json({ personal_best, is_new_record });
}
