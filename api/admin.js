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

  const { password, action, word, is_valid, is_person_name, is_place_name, killer_score } = req.body;

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }

  if (action === 'list') {
    const { data, error } = await supabase.from('rejected_words_summary').select('*').limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ words: data });
  }

  if (action === 'approve' || action === 'reject') {
    if (!word) return res.status(400).json({ error: 'word가 필요합니다.' });
    const chars = [...word];
    const isValid = action === 'approve';
    const { error } = await supabase.from('words').upsert({
      word, is_valid: isValid, is_person_name: false, is_place_name: false,
      first_char: chars[0], last_char: chars[chars.length - 1], source: 'manual'
    }, { onConflict: 'word' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  if (action === 'list-challenges') {
    const { data, error } = await supabase.from('word_challenges').select('word, challenged_at').eq('status', 'pending').order('challenged_at', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    const map = {};
    for (const row of data) {
      if (!map[row.word]) map[row.word] = { word: row.word, challenge_count: 0, last_challenged_at: row.challenged_at };
      map[row.word].challenge_count++;
      if (row.challenged_at > map[row.word].last_challenged_at) map[row.word].last_challenged_at = row.challenged_at;
    }
    return res.json({ challenges: Object.values(map).sort((a, b) => b.challenge_count - a.challenge_count) });
  }

  if (action === 'challenge-uphold' || action === 'challenge-dismiss') {
    const newStatus = action === 'challenge-uphold' ? 'upheld' : 'dismissed';
    await supabase.from('word_challenges').update({ status: newStatus }).eq('word', word).eq('status', 'pending');
    if (action === 'challenge-uphold') {
      const chars = [...word];
      await supabase.from('words').upsert({ word, is_valid: false, is_person_name: false, is_place_name: false, first_char: chars[0], last_char: chars[chars.length - 1], source: 'manual' }, { onConflict: 'word' });
    }
    return res.json({ success: true });
  }

  if (action === 'add-word') {
    const chars = [...word];
    const { data: existing } = await supabase.from('words').select('word').eq('word', word).maybeSingle();
    if (existing) return res.json({ success: true, alreadyExists: true });
    const { error } = await supabase.from('words').insert({ word, is_valid: true, is_person_name: false, is_place_name: false, first_char: chars[0], last_char: chars[chars.length - 1], source: 'manual' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, alreadyExists: false });
  }

  // 단어 관리: 검색
  if (action === 'search-word') {
    const { data, error } = await supabase.from('words').select('*').eq('word', word).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ word: data });
  }

  // 단어 관리: 수정
  if (action === 'update-word') {
    const { error } = await supabase.from('words').update({
      is_valid, is_person_name, is_place_name, killer_score
    }).eq('word', word);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(400).json({ error: '유효하지 않은 action입니다.' });
}