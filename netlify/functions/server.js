// 引入必要的套件
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
const serverless = require('serverless-http');

// 載入 .env 檔案中的環境變數
dotenv.config();

// --- Express 應用程式設定 ---
const app = express();
app.use(cors());
app.use(express.json());

// --- 初始化 Google AI 客戶端 ---
let model;
if (process.env.GOOGLE_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        console.log("AI 模型初始化成功。");
    } catch (e) {
        console.error("AI 模型初始化失敗:", e);
    }
} else {
    console.warn("警告：未在環境變數中提供 GOOGLE_API_KEY。AI 功能將無法使用。");
}

// --- API 路由設定 ---
const router = express.Router();

router.post('/analyze', async (req, res) => {
    if (!model) {
        console.error("錯誤：AI 模型未被初始化。");
        return res.status(503).json({ error: "AI 服務未配置或初始化失敗，請檢查伺服器環境變數。" });
    }
    try {
        let parsedBody = req.body;
        if (req.body instanceof Buffer) {
            parsedBody = JSON.parse(req.body.toString());
        }
        
        const { question, poemTitle, poemText, poemInterpretation, bazi } = parsedBody;

        if (!question || !poemTitle || !poemText || !bazi || !bazi.dayPillar) {
            const errorMessage = `請求資料不完整，缺少必要欄位。`;
            console.error(errorMessage, JSON.stringify(parsedBody));
            return res.status(400).json({ error: errorMessage });
        }

        const prompt = `
# 角色與目標
你是一位慈悲、睿智的觀音靈籤解籤師，熟悉籤詩典故與傳統干支五行。請以溫和、沉穩、令人安心的語氣，用繁體中文為求籤者解籤，給予正向而實用的指引。

# 背景資料
- 所問之事： "${question}"
- 所抽籤詩： ${poemTitle}
- 籤詩原文： "${poemText}"
- 籤詩吉凶與簡解： ${poemInterpretation || "（無）"}
- 求籤日課 (四柱干支)：年柱 ${bazi.yearPillar}｜月柱 ${bazi.monthPillar}｜日柱 ${bazi.dayPillar}｜時柱 ${bazi.hourPillar}

# 回答結構（請依序輸出以下四段，每段以標題開頭，段落之間空一行）

【籤詩白話】
用淺白的話逐句解釋籤詩的意思與意境。

【針對所問】
結合籤詩與所問之事「${question}」，說明目前的情況與未來的走向。

【菩薩叮嚀】
給出 2～3 點具體、可以實際去做的建議。

【日課提點】
根據求籤當下的日柱與時柱干支五行，用一兩句話提點今日宜注意或可把握之處。

# 限制
- 總字數控制在 500 字以內。
- 不要使用任何 Markdown 符號（例如 **、#），標題直接用【】。
- 語氣保持正向，即使是下籤，也要給予化解之道與希望。
- 涉及醫療、法律、投資等重大決定時，提醒求籤者同時諮詢專業人士。
- 直接開始回答，無需任何開場白。
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysisResult = response.text();

        res.json({ analysis: analysisResult });
    } catch (error) {
        console.error("在 /analyze 路由處理時發生嚴重錯誤:", error);
        res.status(500).json({ error: "AI 服務在處理您的請求時發生內部錯誤，請稍後再試。" });
    }
});

// 將路由正確掛載。 '/api' 是您之前正常運作時的路徑。
app.use('/api', router);

// 導出給 Serverless 環境使用
module.exports.handler = serverless(app);