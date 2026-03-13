import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── GET: ranking ──────────────────────────────────────────────
  if (action === 'ranking') {
    const fetchAll = req.query.all === '1';
    const fields = fetchAll
      ? 'nickname, display_name, player_word_count, ended_at, ip_address'
      : 'nickname, display_name, player_word_count, ended_at';
    let query = supabase
      .from('game_sessions')
      .select(fields)
      .eq('result', 'player_win')
      .order('player_word_count', { ascending: false });
    if (!fetchAll) query = query.limit(10);
    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ranking: (data ?? []).map((row, i) => ({
        rank:              i + 1,
        nickname:          row.nickname,
        display_name:      row.display_name,
        player_word_count: row.player_word_count,
        ended_at:          row.ended_at,
        ...(fetchAll && { ip_address: row.ip_address }),
      })),
    });
  }

  // ── GET: nickname-words ────────────────────────────────────────
  if (action === 'nickname-words') {
    const { data, error } = await supabase
      .from('nickname_words')
      .select('word, type')
      .order('id');

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      adjectives: data.filter(w => w.type === 'adjective').map(w => w.word),
      places:     data.filter(w => w.type === 'place').map(w => w.word),
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // ── POST: game-start ───────────────────────────────────────────
  if (action === 'start') {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id가 필요합니다.' });

    const { data: player } = await supabase
      .from('players')
      .select('nickname, display_name')
      .eq('session_id', session_id)
      .maybeSingle();

    if (!player) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

    const ip_address = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.headers['x-real-ip']
      || '';

    const { data, error } = await supabase
      .from('game_sessions')
      .insert({ session_id, nickname: player.nickname, display_name: player.display_name, ip_address })
      .select('id')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ game_id: data.id });
  }

  // ── POST: game-end ─────────────────────────────────────────────
  if (action === 'end') {
    const { game_id, session_id, result, player_word_count, total_turns, word_history } = req.body;
    if (!game_id || !session_id) {
      return res.status(400).json({ error: 'game_id와 session_id가 필요합니다.' });
    }

    await supabase.from('game_sessions').update({
      ended_at:          new Date().toISOString(),
      result:            result ?? 'abandoned',
      player_word_count: player_word_count ?? 0,
      total_turns:       total_turns ?? 0,
      word_history:      word_history ?? [],
    }).eq('id', game_id);

    const { data: best } = await supabase
      .from('game_sessions')
      .select('player_word_count')
      .eq('session_id', session_id)
      .eq('result', 'player_win')
      .order('player_word_count', { ascending: false })
      .limit(1)
      .maybeSingle();

    const personal_best = best?.player_word_count ?? 0;
    const is_new_record = result === 'player_win' && player_word_count >= personal_best;
    return res.json({ personal_best, is_new_record });
  }

  return res.status(400).json({ error: 'invalid action' });
}
