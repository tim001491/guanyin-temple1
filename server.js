// 引入必要的套件
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');

// 載入 .env 檔案中的環境變數
dotenv.config();

// 初始化 Express 應用
const app = express();
const port = 3000;

// 設定中介軟體 (Middleware)
app.use(cors());
app.use(express.json());

// 初始化 Google AI 客戶端
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 建立 API 端點來處理分析請求
app.post('/api/analyze', async (req, res) => {
  try {
    const { question, poemTitle, poemText, bazi } = req.body;

    // 建立給 AI 的提示 (Prompt)
    const prompt = `
# 角色設定
你是專業的分析師，深諳《易經》、梅花易數、籤詩解讀。你的語氣應溫和、富有哲理且充滿智慧，能夠給予求籤者清晰的指引與心靈的慰藉。多從正面角度提供建議。

# 背景資料
一位信眾前來求籤，以下是祂求得的資訊：

1.  **所問之事**: "${question}"
2.  **求籤時間四柱**:
    - 年柱: ${bazi.year}
    - 月柱: ${bazi.month}
    - 日柱: ${bazi.day}
    - 時柱: ${bazi.hour}
3.  **所抽籤詩**:
    - 標題: ${poemTitle}
    - 內容: 
    "${poemText}"

# 任務指令
請根據以上所有資訊，為這位信眾提供一次綜合性的解析。你的解析需要包含以下幾個層次：

1.  **時間卦象分析**: 依據梅花易數時間起卦法，用本卦、互卦、變卦分析卦象當下時空的能量狀態與此問題的對應關係。
(為目前時間換算，不要出現生辰字樣)。(不要出現貧道、老朽等類似用語)
2.  **籤詩核心寓意**: 深入解讀這首籤詩的字面與內在含義。籤詩中的關鍵詞代表了什麼？
3.  **綜合解析與建議**: 將時間的卦象與籤詩的寓意結合，針對信眾提出的「具體問題」給出綜合性的回答。
    - 指出目前情況的「機」與「變」，需要留意的地方。
    - 提出具體的、可行的行動建議或心態調整方向。
    - 最後以一段溫暖、鼓勵的話語作結，給予信眾信心與希望。
    - 排版需條例分明，建議部分1.2.3...以此類推要分段，不要連在一起。
請以流暢、完整的段落文筆，用繁體中文呈現你的解析。
`;

    // 呼叫 Google Gemini API
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const analysisResult = response.text();

    // 將解析結果以 JSON 格式回傳給前端
    res.json({ analysis: analysisResult });

  } catch (error) {
    console.error("Google AI API 呼叫失敗:", error);
    res.status(500).json({ error: "AI 服務發生錯誤，請稍後再試。可能是 API 金鑰設定有誤或網路問題。" });
  }
});

// 啟動伺服器
app.listen(port, () => {
  console.log(`觀音禪寺解籤後端伺服器 (Google Gemini) 已啟動，監聽埠號 http://localhost:${port}`);
  console.log('請確保您的 .env 檔案已設定 GOOGLE_API_KEY');
});