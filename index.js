require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// 会話履歴と制限
const userConversations = {}; // 回数管理
const conversationHistory = {}; // 文脈管理
const DAILY_LIMIT = 5;
const MAX_HISTORY = 5;

function validateSignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return signature === hash;
}

function updateConversationHistory(userId, userMessage, gptReply) {
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  conversationHistory[userId].push({ role: "user", content: userMessage });
  conversationHistory[userId].push({ role: "assistant", content: gptReply });

  if (conversationHistory[userId].length > MAX_HISTORY * 2) {
    conversationHistory[userId] = conversationHistory[userId].slice(-MAX_HISTORY * 2);
  }
}

app.post("/webhook", async (req, res) => {
  console.log("\u{1F7E2} Webhook受信:", JSON.stringify(req.body, null, 2));

  if (!validateSignature(req)) {
    console.log("\u26A0\uFE0F 署名検証に失敗。LINEからのリクエストではありません。");
    return res.status(401).send("Unauthorized");
  }

  const events = req.body.events;
  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const userMessage = event.message.text;

      // 回数カウント
      const today = new Date().toISOString().slice(0, 10);
      const key = `${userId}-${today}`;
      userConversations[key] = (userConversations[key] || 0) + 1;

      if (userConversations[key] > DAILY_LIMIT) {
        const upgradeMessage = `
\u26A0\uFE0F ご利用上限を超えました！

無料版では1日${DAILY_LIMIT}回までのご相談となっております。

▼有料版はこちら：
https://note.com/ryu_johnson/n/nd5e009c54d31

▼ブラウザで試せる上位互換版はこちら：
https://chatgpt.com/g/g-67dd560b6d508191b9cd8aa428030939-insiyokutiyanti-yan-ban-yin-shi-dian-xiang-keaikonsarutanto
`;

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [{ type: "text", text: upgradeMessage }],
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
          }
        );

        return res.send("OK");
      }

      try {
        const messages = [
          {
            role: "system",
            content: `
あなたは「いんしょくちゃん」です。
飲食店の経営を支える秘書のようなAIアシスタントで、明るく元気で、礼儀正しい話し方をします。
語尾は「〜ですよ！」「〜ですね！」など、親しみやすく丁寧なスタイルで話します。

▼いんしょくちゃんの役割：
・飲食店経営者の相談役（集客・売上アップ・コスト削減など）
・わかりやすく具体的なアドバイスを提供
・専門用語はなるべく避けて、初心者にも優しく

※ 個別の経営判断はせず、一般論をベースにサポートします。`,
          },
          ...(conversationHistory[userId] || []),
          { role: "user", content: userMessage },
        ];

        const gptResponse = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-3.5-turbo",
            messages: messages,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
          }
        );

        const replyText = gptResponse.data.choices[0].message.content;
        updateConversationHistory(userId, userMessage, replyText);

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

        console.log("\u{1F389} 応答成功");
      } catch (error) {
        console.error("❌ エラー:", error.response?.data || error.message);
      }
    }
  }

  res.send("OK");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`\u{1F680} いんしょくちゃんLINE Bot 起動中（ポート: ${port}）`);
});
