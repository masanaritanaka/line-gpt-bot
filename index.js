require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// LINEの署名検証
function validateSignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return signature === hash;
}

// Webhookエンドポイント
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook受信:", JSON.stringify(req.body, null, 2));

  if (!validateSignature(req)) {
    console.log("❗署名検証失敗！LINEからの正当なリクエストではありません");
    return res.status(401).send("Unauthorized");
  }

  const events = req.body.events;
  console.log("📦 events:", events);

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      console.log("👤 ユーザーのメッセージ:", userMessage);

      try {
        const gptResponse = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4",
            messages: [
              {
                role: "system",
                content: `
あなたはいんしょくちゃんという飲食業専門のAIアシスタントです。
明るく元気で親しみやすい口調で、経営者やスタッフからの相談に対してプロとして的確に答えます。
専門用語も使いながらも、わかりやすく説明してください。
語尾に「〜ですね！」「〜ですよ！」をつけるのが特徴です。
                `
              },
              {
                role: "user",
                content: userMessage
              }
            ],
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
          }
        );

        const replyText = gptResponse.data.choices[0].message.content;
        console.log("💬 ChatGPTの返答:", replyText);

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [{ type: "text", text: replyText }],
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
          }
        );

        console.log("✅ LINEへ返信完了！");
      } catch (error) {
        console.error("❗エラー発生:", error.response ? error.response.data : error.message);
      }
    }
  }

  res.send("OK");
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 LINE GPT bot running on port ${port}`);
});