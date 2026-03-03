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

  const { password, action, word } = req.body;

  // TODO: 테스트용 - 비밀번호 검증 비활성화
  // if (password !== process.env.ADMIN_PASSWORD) {
  //   return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  // }

  if (action === 'list') {
    const { data, error } = await supabase
      .from('rejected_words_summary')
      .select('*')
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ words: data });
  }

  if (action === 'approve' || action === 'reject') {
    if (!word) return res.status(400).json({ error: 'word가 필요합니다.' });

    const chars = [...word];
    const firstChar = chars[0];
    const lastChar  = chars[chars.length - 1];
    const isValid   = action === 'approve';

    const { error } = await supabase.from('words').upsert({
      word,
      is_valid:       isValid,
      is_person_name: false,
      is_place_name:  false,
      first_char:     firstChar,
      last_char:      lastChar,
      source:         'manual',
    }, { onConflict: 'word' });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, action, word });
  }

  // 이의 제기 목록 (pending 상태, 단어별 집계)
  if (action === 'list-challenges') {
    const { data, error } = await supabase
      .from('word_challenges')
      .select('word, challenged_at, nickname')
      .eq('status', 'pending')
      .order('challenged_at', { ascending: false })
      .limit(500);

    if (error) return res.status(500).json({ error: error.message });

    // JS에서 단어별 집계
    const map = {};
    for (const row of data) {
      if (!map[row.word]) {
        map[row.word] = { word: row.word, challenge_count: 0, last_challenged_at: row.challenged_at };
      }
      map[row.word].challenge_count++;
      if (row.challenged_at > map[row.word].last_challenged_at) {
        map[row.word].last_challenged_at = row.challenged_at;
      }
    }

    const challenges = Object.values(map)
      .sort((a, b) => b.challenge_count - a.challenge_count);

    return res.json({ challenges });
  }

  // 이의 제기 처리: uphold(제외) / dismiss(유지)
  if (action === 'challenge-uphold' || action === 'challenge-dismiss') {
    if (!word) return res.status(400).json({ error: 'word가 필요합니다.' });

    const newStatus = action === 'challenge-uphold' ? 'upheld' : 'dismissed';

    await supabase
      .from('word_challenges')
      .update({ status: newStatus })
      .eq('word', word)
      .eq('status', 'pending');

    // 제외 처리 시 words 테이블도 is_valid=false
    if (action === 'challenge-uphold') {
      const chars = [...word];
      await supabase.from('words').upsert({
        word,
        is_valid:       false,
        is_person_name: false,
        is_place_name:  false,
        first_char:     chars[0],
        last_char:      chars[chars.length - 1],
        source:         'manual',
      }, { onConflict: 'word' });
    }

    return res.json({ success: true, action, word });
  }

  return res.status(400).json({ error: '유효하지 않은 action입니다.' });
}
