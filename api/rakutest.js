export default async function handler(req, res) {
  const params = new URLSearchParams({
    applicationId: process.env.RAKUTEN_APP_ID,
    accessKey: process.env.RAKUTEN_ACCESS_KEY,
    keyword: "lip",
    hits: "1",
    formatVersion: "2",
    format: "json"
  });
  try {
    const r = await fetch(
      "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?" + params.toString(),
      { headers: { Referer: "https://glowz-cosme.vercel.app/", Origin: "https://glowz-cosme.vercel.app" } }
    );
    const text = await r.text();
    res.status(200).json({ rakutenStatus: r.status, body: text.slice(0, 1500) });
  } catch (e) {
    res.status(200).json({ fetchError: e.message });
  }
}
