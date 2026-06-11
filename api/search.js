// GLOWZ✦COSME - 商品検索API (Vercelサーバーレス関数)
// ブラウザから直接Claude APIを呼べない(CORS)ので、この「裏側」が代わりに呼びます。
// APIキーはVercelの環境変数 ANTHROPIC_API_KEY に設定してください(コードには書かない!)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POSTのみ対応しています" });
  }

  const { query = "", categories = [], budget = "指定なし" } = req.body || {};

  // かんたんな入力チェック(いたずら・暴走防止)
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
- 回答はJSONのみ。前置き・説明・Markdownのコードブロック記号は一切付けない

JSON形式:
{"products":[{"brand":"ブランド名","name":"商品名","price":"価格(例: 1,650円(税込))","category":"カテゴリ","point":"なぜこの人に合うのか、2文程度のおすすめ理由","buy":"主な購入場所(例: ドラッグストア、公式オンライン)"}]}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // 安くて速いモデル(コスト対策)
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: "user", content: userRequest }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 3 // 1回の検索で使うWeb検索の上限(コスト対策)
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic API error:", JSON.stringify(data));
      return res.status(502).json({ error: "AIの呼び出しに失敗しました" });
    }

    // テキストブロックをつなげて、JSON部分を取り出す
    const fullText = (data.content || [])
      .map(block => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    const cleaned = fullText.replace(/```json|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "結果の読み取りに失敗しました" });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const products = Array.isArray(parsed.products) ? parsed.products.slice(0, 5) : [];

    return res.status(200).json({ products });
  } catch (err) {
    console.error("search.js error:", err);
    return res.status(500).json({ error: "サーバーでエラーが起きました" });
  }
}
