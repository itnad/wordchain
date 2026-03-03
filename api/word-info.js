const STDICT_KEY = process.env.STDICT_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const word = req.query.word?.trim();
  if (!word) return res.status(400).json({ error: 'word required' });

  try {
    const url = new URL('https://stdict.korean.go.kr/api/search.do');
    url.searchParams.set('key', STDICT_KEY);
    url.searchParams.set('q', word);
    url.searchParams.set('type_search', 'exact');
    url.searchParams.set('req_type', 'json');

    const response = await fetch(url.toString());
    const text = await response.text();

    const definitions = [];
    try {
      const json = JSON.parse(text);
      const rawItems = json?.channel?.item ?? [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];

      for (const item of items) {
        const senses = item?.sense_info ?? [];
        const senseArr = Array.isArray(senses) ? senses : [senses];
        for (const sense of senseArr) {
          if (sense?.definition) {
            const pos = sense.pos ?? item.pos ?? '';
            definitions.push(pos ? `[${pos}] ${sense.definition}` : sense.definition);
          }
        }
      }
    } catch {
      // parse error – no definitions
    }

    return res.json({ word, definitions });
  } catch (err) {
    console.error('word-info error:', err);
    return res.status(503).json({ word, definitions: [] });
  }
}
