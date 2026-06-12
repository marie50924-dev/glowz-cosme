// GLOWZ✦COSME - 商品検索API v2 (Claude AI + 楽天市場API)
// 流れ: ①Claude AIがWeb検索で商品を提案 → ②楽天市場APIで実物を照合 →
//       ③正確な商品URL・画像・現在価格つきで返す
// 必要な環境変数: ANTHROPIC_API_KEY, RAKUTEN_APP_ID

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POSTのみ対応しています" });
  }

  const { query = "", categories = [], budget = "指定なし" } = req.body || {};

  if (typeof query !== "string" || query.length > 200) {
    return res.status(400).json({ error: "検索ワードが長すぎます" });
  }
  if (!query.trim() && (!Array.isArray(categories) || categories.length === 0)) {
    return res.status(400).json({ error: "検索内容が空です" });
  }

  const userRequest = [
    query.trim() && `ほしいもの: ${query.trim()}`,
    categories.length > 0 && `カテゴリ: ${categories.join("、")}`,
    `予算: ${budget}`
  ].filter(Boolean).join("\n");

  const systemPrompt = `あなたは日本のコスメに詳しいビューティーアドバイザーです。
ユーザーの「こんなコスメがほしい」という要望に対して、Web検索を使って、いま日本で実際に購入できる商品を最大5個提案してください。

ルール:
- 必ずWeb検索をして、実在する商品だけを提案する(架空の商品名は絶対に作らない)
- 価格帯はユーザーの予算に合わせる
- searchWord には楽天市場で検索するための「ブランド名 商品名」の短いキーワードを入れる
- 回答はJSONのみ。前置き・説明・Markdownのコードブロック記号は一切付けない

JSON形式:
{"products":[{"brand":"ブランド名","name":"商品名","price":"価格(例: 1,650円(税込))","category":"カテゴリ","point":"なぜこの人に合うのか、2文程度のおすすめ理由","buy":"主な購入場所","searchWord":"楽天検索用キーワード"}]}`;

  try {
    // ① Claude AIに商品を提案してもらう
    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: "user", content: userRequest }],
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 3 }
        ]
      })
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error("Anthropic API error:", JSON.stringify(aiData));
      return res.status(502).json({ error: "AIの呼び出しに失敗しました" });
    }

    const fullText = (aiData.content || [])
      .map(block => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
    const cleaned = fullText.replace(/```json|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "結果の読み取りに失敗しました" });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const aiProducts = Array.isArray(parsed.products) ? parsed.products.slice(0, 5) : [];

    // ② 各商品を楽天市場APIで照合(並列で実行)
    const enriched = await Promise.all(
      aiProducts.map(async (p) => {
        const keyword = (p.searchWord || `${p.brand} ${p.name}`).slice(0, 100);
        try {
          const params = new URLSearchParams({
            applicationId: process.env.RAKUTEN_APP_ID,
                        accessKey: process.env.RAKUTEN_ACCESS_KEY,

            keyword: keyword,
            hits: "1",
            sort: "standard",
            formatVersion: "2"
          });
          const rkRes = await fetch(
                        "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?" + params.toString(),
                        { headers: { Referer: "https://glowz-cosme.vercel.app/", Origin: "https://glowz-cosme.vercel.app" } }
^_^

          );
          if (!rkRes.ok) throw new Error("rakuten status " + rkRes.status);
          const rkData = await rkRes.json();
          const item = rkData.Items && rkData.Items[0];
          if (item) {
            const img = (item.mediumImageUrls && item.mediumImageUrls[0]) || "";
            return {
              ...p,
              rakutenUrl: item.itemUrl || "",
              rakutenPrice: item.itemPrice ? item.itemPrice.toLocaleString("ja-JP") + "円" : "",
              image: img.replace("?_ex=128x128", "?_ex=300x300"),
              rakutenName: item.itemName || ""
            };
          }
        } catch (e) {
          console.error("Rakuten lookup failed for:", keyword, e.message);
        }
        // 楽天で見つからなくてもAIの提案はそのまま返す
        return { ...p, rakutenUrl: "", rakutenPrice: "", image: "" };
      })
    );

    return res.status(200).json({ products: enriched });
  } catch (err) {
    console.error("search.js error:", err);
    return res.status(500).json({ error: "サーバーでエラーが起きました" });
  }
}
