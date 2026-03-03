export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // stdict API 연결 테스트
  const STDICT_KEY = process.env.STDICT_KEY;
  let sdictResult = {};
  try {
    const url = new URL('https://stdict.korean.go.kr/api/search.do');
    url.searchParams.set('key', STDICT_KEY);
    url.searchParams.set('q', '사과');
    url.searchParams.set('type_search', 'exact');
    url.searchParams.set('req_type', 'json');

    const start = Date.now();
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    const text = await r.text();
    sdictResult = {
      status: r.status,
      bodyLength: text.length,
      ms: Date.now() - start,
    };
  } catch (err) {
    sdictResult = { error: err.message };
  }

  return res.json({
    region:    process.env.VERCEL_REGION ?? 'unknown (로컬 또는 미노출)',
    stdict:    sdictResult,
    timestamp: new Date().toISOString(),
  });
}
