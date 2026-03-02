import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateNickname(sessionId, displayName, adjectives, places) {
  const hex  = sessionId.replace(/-/g, '');
  const seg1 = parseInt(hex.slice(0, 8),  16);
  const seg2 = parseInt(hex.slice(8, 16), 16);
  const seg3 = parseInt(hex.slice(16, 24), 16);

  const adj1  = adjectives[seg1 % adjectives.length];
  const place = places[seg2 % places.length];
  let   adj2  = adjectives[seg3 % adjectives.length];
  if (adj1 === adj2) adj2 = adjectives[(seg3 + 1) % adjectives.length];

  return `${adj1} ${place}의 ${adj2} ${displayName}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { session_id, display_name } = req.body;
  if (!session_id || !display_name) {
    return res.status(400).json({ error: 'session_id와 display_name이 필요합니다.' });
  }

  // 기존 세션 확인
  const { data: existing } = await supabase
    .from('players')
    .select('*')
    .eq('session_id', session_id)
    .maybeSingle();

  if (existing) {
    await supabase.from('players')
      .update({ last_seen: new Date().toISOString() })
      .eq('session_id', session_id);
    return res.json({
      nickname:     existing.nickname,
      display_name: existing.display_name,
      is_new:       false,
    });
  }

  // 닉네임 단어 목록 조회
  const { data: words } = await supabase
    .from('nickname_words')
    .select('word, type');

  const adjectives = (words ?? []).filter(w => w.type === 'adjective').map(w => w.word);
  const places     = (words ?? []).filter(w => w.type === 'place').map(w => w.word);

  const nickname = generateNickname(session_id, display_name, adjectives, places);

  await supabase.from('players').insert({
    session_id,
    display_name,
    nickname,
  });

  return res.json({ nickname, display_name, is_new: true });
}
