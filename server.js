// 引入必要的套件
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');

// 載入 .env 檔案中的環境變數
dotenv.config();

// --- 梅花易數計算模組 ---
// 定義八卦，包含卦名、卦象、五行、數值
const trigrams = {
    1: { name: "乾", symbol: "☰", element: "金" },
    2: { name: "兌", symbol: "☱", element: "金" },
    3: { name: "離", symbol: "☲", element: "火" },
    4: { name: "震", symbol: "☳", element: "木" },
    5: { name: "巽", symbol: "☴", element: "木" },
    6: { name: "坎", symbol: "☵", element: "水" },
    7: { name: "艮", symbol: "☶", element: "土" },
    8: { name: "坤", symbol: "☷", element: "土" }
};

// 64卦名稱 (可根據需要擴充更多資訊)
const hexagrams = {
    "11": "乾為天", "12": "天澤履", "13": "天火同人", "14": "天雷無妄", "15": "天風姤", "16": "天水訟", "17": "天山遁", "18": "天地否",
    "21": "澤天夬", "22": "兌為澤", "23": "澤火革", "24": "澤雷隨", "25": "澤風大過", "26": "澤水困", "27": "澤山咸", "28": "澤地萃",
    "31": "火天大有", "32": "火澤睽", "33": "離為火", "34": "火雷噬嗑", "35": "火風鼎", "36": "火水未濟", "37": "火山旅", "38": "火地晉",
    "41": "雷天大壯", "42": "雷澤歸妹", "43": "雷火豐", "44": "震為雷", "45": "雷風恆", "46": "雷水解", "47": "雷山小過", "48": "雷地豫",
    "51": "風天小畜", "52": "風澤中孚", "53": "風火家人", "54": "風雷益", "55": "巽為風", "56": "風水渙", "57": "風山漸", "58": "風地觀",
    "61": "水天需", "62": "水澤節", "63": "水火既濟", "64": "水雷屯", "65": "水風井", "66": "坎為水", "67": "水山蹇", "68": "水地比",
    "71": "山天大畜", "72": "山澤損", "73": "山火賁", "74": "山雷頤", "75": "山風蠱", "76": "山水蒙", "77": "艮為山", "78": "山地剝",
    "81": "地天泰", "82": "地澤臨", "83": "地火明夷", "84": "地雷復", "85": "地風升", "86": "地水師", "87": "地山謙", "88": "坤為地"
};

// 根據時間四柱計算梅花易數卦象
function getPlumBlossomHexagrams(bazi) {
    const { year, month, day, hour } = bazi;

    // 將年月日時的天干地支轉為數值 (此處簡化，直接使用數值)
    // 注意：一個完整的天干地支轉換系統會更複雜，此處為快速實現
    const yearNum = parseInt(year.match(/\d+/g) ? year.match(/\d+/g)[0] : "1");
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);
    const hourNum = parseInt(hour.match(/\d+/g) ? hour.match(/\d+/g)[0] : "1");

    // 計算上卦、下卦、動爻
    const upperNum = (yearNum + monthNum + dayNum) % 8 || 8;
    const lowerNum = (yearNum + monthNum + dayNum + hourNum) % 8 || 8;
    const movingLine = (yearNum + monthNum + dayNum + hourNum) % 6 || 6;

    // 取得本卦
    const mainHexagramKey = `${upperNum}${lowerNum}`;
    const mainHexagramName = hexagrams[mainHexagramKey];
    const mainUpperTrigram = trigrams[upperNum];
    const mainLowerTrigram = trigrams[lowerNum];

    // 為了簡化，我們直接將本卦和動爻資訊給AI，它能自行理解其關聯
    return {
        main: {
            name: mainHexagramName,
            upper: mainUpperTrigram,
            lower: mainLowerTrigram
        },
        movingLine: movingLine
    };
}


// --- Express 應用程式設定 ---
const app = express();
const port = process.env.PORT || 3000;

// 設定中介軟體 (Middleware)
app.use(cors());
app.use(express.json());

// 初始化 Google AI 客戶端
let model;
if (process.env.GOOGLE_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
} else {
    console.warn("警告：未提供 GOOGLE_API_KEY。AI 功能將無法使用。");
}


// 建立 API 端點來處理分析請求
app.post('/api/analyze', async (req, res) => {
    if (!model) {
        return res.status(503).json({ error: "AI 服務未配置，請檢查伺服器環境變數。" });
    }

    try {
        const { question, poemTitle, poemText, bazi } = req.body;
        
        // 驗證輸入
        if (!question || !poemTitle || !poemText || !bazi) {
            return res.status(400).json({ error: "請求資料不完整，缺少 question, poemTitle, poemText 或 bazi。" });
        }

        // 1. 進行梅花易數計算
        const hexagramsInfo = getPlumBlossomHexagrams(bazi);
        
        // 2. 建立給 AI 的提示 (Prompt)，這次直接給予計算結果
        const prompt = `
# 角色設定
你是一位專業的籤詩與易經解析大師。你的語氣應溫和、富有哲理且充滿智慧，能夠給予求籤者清晰的指引與心靈的慰藉。請多從正面角度提供建議，並以繁體中文回答。在回答中，請避免使用「貧道」、「老朽」等自稱。

# 背景資料
一位信眾前來求籤，以下是祂求得的所有資訊：

1.  **所問之事**: "${question}"
2.  **求籤時間四柱 (僅供參考)**:
    - 年: ${bazi.year}, 月: ${bazi.month}, 日: ${bazi.day}, 時: ${bazi.hour}
3.  **依此時間推算的梅花易數卦象**:
    - **本卦**: **${hexagramsInfo.main.name}** (上${hexagramsInfo.main.upper.name}${hexagramsInfo.main.upper.symbol}，下${hexagramsInfo.main.lower.name}${hexagramsInfo.main.lower.symbol})
    - **動爻**: 第 **${hexagramsInfo.movingLine}** 爻
4.  **所抽籤詩**:
    - **標題**: ${poemTitle}
    - **內容**: "${poemText}"

# 任務指令
請根據以上所有資訊，為這位信眾提供一次綜合性的解析。你的解析需要包含以下幾個層次：

1.  **時間卦象分析**:
    - 簡要說明「**${hexagramsInfo.main.name}**」這個 **本卦** 的基本涵義。
    - 根據第 **${hexagramsInfo.movingLine}** **動爻** 的位置，分析此卦象在此時空中的「**變動趨勢**」，並說明它如何與所問之事對應。

2.  **籤詩核心寓意**:
    - 深入解讀「**${poemTitle}**」這首籤詩的字面與內在含義。籤詩中的關鍵詞（例如：龍、虎、風、雲、月、舟等）代表了什麼象徵意義？

3.  **綜合解析與建議**:
    - 將「**時間卦象的變動趨勢**」與「**籤詩的核心寓意**」結合，針對信眾提出的「**${question}**」這個具體問題，給出綜合性的回答。
    - 指出目前情況的「**機遇**」與「**挑戰**」，以及需要特別留意的地方。
    - 提出 1 至 3 條具體的、可行的行動建議或心態調整方向。請用條列式分點說明，不要將所有建議連在一起。
    - 最後，請以一段溫暖、充滿鼓勵與智慧的話語作結，給予信眾信心與希望。

請確保整體排版條理分明，文筆流暢優美。
`;

        // 3. 呼叫 Google Gemini API
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysisResult = response.text();

        // 4. 將解析結果與卦象資訊一併以 JSON 格式回傳給前端
        res.json({ 
            analysis: analysisResult,
            hexagram: hexagramsInfo 
        });

    } catch (error) {
        console.error("Google AI API 呼叫失敗:", error);
        res.status(500).json({ error: "AI 服務發生錯誤，請稍後再試。可能是 API 金鑰設定有誤或網路問題。" });
    }
});

// 啟動伺服器
app.listen(port, () => {
    console.log(`觀音禪寺解籤後端伺服器 (優化版) 已啟動，監聽埠號 http://localhost:${port}`);
    if (model) {
        console.log("Google Gemini AI 已成功初始化。");
    } else {
        console.error("錯誤：Google Gemini AI 初始化失敗，請檢查 .env 檔案中的 GOOGLE_API_KEY。");
    }
});
