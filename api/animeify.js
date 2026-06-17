// ============================================================
//  api/animeify.js
//  GLOWZ✦COSME  写真アニメ化  Vercel サーバーレス関数
//
//  役割: フロントから送られた写真+プロンプトをGeminiに渡し、
//        アニメ化された画像を返す。APIキーはここで隠す。
//
//  必要な準備:
//   1. Google AI Studio (aistudio.google.com) でAPIキー取得
//   2. Vercel → Settings → Environment Variables に
//        名前: GEMINI_API_KEY   値: 取得したキー
//      を登録して再デプロイ
// ============================================================

// 使うモデル: Nano Banana 2 (高速・低コスト)。
// もっと高品質にしたいときは "gemini-3-pro-image" に変えてもOK。
const MODEL = "gemini-3.1-flash-image";

export default async function handler(req, res) {
  // --- CORS（同一ドメインなら不要だが念のため許可）---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POSTで送ってください" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY が設定されていません。VercelのEnvironment Variablesに登録してください。",
    });
  }

  try {
    // Vercelは通常 req.body をパース済み。文字列で来た場合に備えて両対応。
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { imageBase64, mimeType, prompt } = body;

    if (!imageBase64 || !prompt) {
      return res
        .status(400)
        .json({ error: "imageBase64 と prompt が必要です" });
    }

    // --- Gemini API へのリクエスト本体 ---
    // 新形式キー(AQ.で始まる)は ?key= ではなく x-goog-api-key ヘッダーで渡す
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL +
      ":generateContent";

    const geminiBody = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType || "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
      // 画像を返してもらう設定
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    };

    const gRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(geminiBody),
    });

    const gData = await gRes.json();

    if (!gRes.ok) {
      // Geminiからのエラーをそのまま見えるように返す（rakutest.jsと同じ思想）
      return res.status(gRes.status).json({
        error: "Gemini APIエラー",
        detail: gData,
      });
    }

    // --- レスポンスから画像パートを取り出す ---
    const parts = gData?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(
      (p) => p.inline_data?.data || p.inlineData?.data
    );

    if (!imgPart) {
      // 画像が返らなかった場合（安全フィルタ等）の理由を返す
      const textPart = parts.find((p) => p.text)?.text;
      return res.status(502).json({
        error: "画像が生成されませんでした",
        reason: textPart || gData?.promptFeedback || "不明",
        detail: gData,
      });
    }

    const inline = imgPart.inline_data || imgPart.inlineData;
    return res.status(200).json({
      imageBase64: inline.data,
      mimeType: inline.mime_type || inline.mimeType || "image/png",
    });
  } catch (err) {
    return res.status(500).json({ error: "関数内エラー", detail: String(err) });
  }
}
