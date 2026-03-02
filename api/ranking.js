import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  // KST 기준 오늘 시작 시각 (UTC)
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow    = new Date(now.getTime() + kstOffset);
  const todayKST  = kstNow.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const todayStart = new Date(todayKST + 'T00:00:00+09:00').toISOString();

  const { data, error } = await supabase
    .from('game_sessions')
    .select('nickname, display_name, player_word_count')
    .eq('result', 'player_win')
    .gte('started_at', todayStart)
    .order('player_word_count', { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });

  const ranking = (data ?? []).map((row, i) => ({
    rank:              i + 1,
    nickname:          row.nickname,
    display_name:      row.display_name,
    player_word_count: row.player_word_count,
  }));

  return res.json({ ranking });
}
