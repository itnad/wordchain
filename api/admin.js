import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===== 두음법칙 =====
const I_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20]);
function decomposeSyllable(char) {
  const code = char.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return null;
  const jong = code % 28;
  const jung = Math.floor((code - jong) / 28) % 21;
  const cho  = Math.floor(code / 28 / 21);
  return { cho, jung, jong };
}
function composeSyllable(cho, jung, jong) {
  return String.fromCharCode((cho * 21 + jung) * 28 + jong + 0xAC00);
}
function getDuemVariants(char) {
  const d = decomposeSyllable(char);
  if (!d) return [char];
  const { cho, jung, jong } = d;
  const variants = [char];
  if (cho === 5) {
    const newCho = I_VOWELS.has(jung) ? 11 : 2;
    const v = composeSyllable(newCho, jung, jong);
    if (v !== char) variants.push(v);
  } else if (cho === 2 && I_VOWELS.has(jung)) {
    const v = composeSyllable(11, jung, jong);
    if (v !== char) variants.push(v);
  }
  return variants;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { password, action, word, is_valid, is_person_name, is_place_name, killer_score } = req.body;

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
    const isValid = action === 'approve';
    const { error } = await supabase.from('words').upsert({
      word, is_valid: isValid, is_person_name: false, is_place_name: false,
      first_char: chars[0], last_char: chars[chars.length - 1], source: 'manual'
    }, { onConflict: 'word' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // 이의 제기 목록 (pending 상태, 단어별 집계)
  if (action === 'list-challenges') {
    const { data, error } = await supabase.from('word_challenges').select('word, challenged_at').eq('status', 'pending').order('challenged_at', { ascending: false }).limit(500);
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
    return res.json({ challenges: Object.values(map).sort((a, b) => b.challenge_count - a.challenge_count) });
  }

  // 이의 제기 처리: uphold(제외) / dismiss(유지)
  if (action === 'challenge-uphold' || action === 'challenge-dismiss') {
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
    return res.json({ success: true });
  }

  // 단어 직접 추가 (관리자 입력용)
  if (action === 'add-word') {
    const chars = [...word];
    if (chars.length !== 3 || !chars.every(c => /[가-힣]/.test(c)))
      return res.status(400).json({ error: '3글자 한글 단어만 입력 가능합니다.' });

    // 기존 등록 여부 확인
    const { data: existing } = await supabase
      .from('words').select('word').eq('word', word).maybeSingle();
    if (existing) {
      return res.json({ success: true, word, alreadyExists: true });
    }
    const { error } = await supabase.from('words').insert({
      word,
      is_valid:       true,
      is_person_name: false,
      is_place_name:  false,
      first_char:     chars[0],
      last_char:      chars[chars.length - 1],
      source:         'manual',
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, alreadyExists: false });
  }

  // 단어 관리: 검색 (부분 검색, 다건)
  if (action === 'search-word') {
    const { data, error } = await supabase
      .from('words')
      .select('word, is_valid, killer_score')
      .ilike('word', `%${word}%`)
      .order('word')
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ words: data ?? [] });
  }

  // 단어 관리: 수정
  if (action === 'update-word') {
    const { error } = await supabase.from('words')
      .update({ is_valid, killer_score })
      .eq('word', word);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // 단어 난이도 일괄 재계산
  if (action === 'recalc-difficulty') {
    // 1. 유효한 단어 전체 조회
    const { data: allWords, error: fetchErr } = await supabase
      .from('words')
      .select('word, first_char, last_char')
      .eq('is_valid', true);
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    // 2. first_char별 단어 수 집계 (두음법칙 변형도 포함)
    const firstCharCount = {};
    for (const w of allWords) {
      if (!w.first_char) continue;
      firstCharCount[w.first_char] = (firstCharCount[w.first_char] || 0) + 1;
    }

    // 3. 각 단어의 last_char로 이어지는 단어 수 계산 → killer_score 결정
    const groups = { 0: [], 1: [], 2: [], null: [] };
    for (const w of allWords) {
      if (!w.last_char) { groups[null].push(w.word); continue; }
      const variants = getDuemVariants(w.last_char);
      const count = variants.reduce((sum, v) => sum + (firstCharCount[v] || 0), 0);
      if      (count === 0) groups[0].push(w.word);
      else if (count === 1) groups[1].push(w.word);
      else if (count === 2) groups[2].push(w.word);
      else                  groups[null].push(w.word);
    }

    // 4. 그룹별 일괄 업데이트 (500개씩 청크)
    const CHUNK = 500;
    for (const [score, words] of Object.entries(groups)) {
      if (words.length === 0) continue;
      const killer_score = score === 'null' ? null : Number(score);
      for (let i = 0; i < words.length; i += CHUNK) {
        const chunk = words.slice(i, i + CHUNK);
        const { error: upErr } = await supabase
          .from('words').update({ killer_score }).in('word', chunk);
        if (upErr) return res.status(500).json({ error: upErr.message });
      }
    }

    return res.json({
      success: true,
      total: allWords.length,
      killer: groups[0].length,
      rare1:  groups[1].length,
      rare2:  groups[2].length,
      normal: groups[null].length,
    });
  }

  // 단어 관리: 삭제
  if (action === 'delete-word') {
    if (!word) return res.status(400).json({ error: 'word가 필요합니다.' });
    const { error } = await supabase.from('words').delete().eq('word', word);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(400).json({ error: '유효하지 않은 action입니다.' });
}
