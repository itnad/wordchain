import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { data, error } = await supabase
    .from('nickname_words')
    .select('word, type')
    .order('id');

  if (error) return res.status(500).json({ error: error.message });

  const adjectives = data.filter(w => w.type === 'adjective').map(w => w.word);
  const places     = data.filter(w => w.type === 'place').map(w => w.word);

  res.json({ adjectives, places });
}
