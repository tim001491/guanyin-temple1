// 引入必要的套件
const express = require('express');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
const serverless = require('serverless-http');

// 載入 .env 檔案中的環境變數
dotenv.config();

// --- Express 應用程式設定 ---
const app = express();
app.use(cors()); // 在正式環境中，建議設定更嚴格的 CORS 策略
app.use(express.json());

// --- 梅花易數計算模組 ---
const trigrams = {
    1: { name: "乾", symbol: "☰", element: "金" }, 2: { name: "兌", symbol: "☱", element: "金" },
    3: { name: "離", symbol: "☲", element: "火" }, 4: { name: "震", symbol: "☳", element: "木" },
    5: { name: "巽", symbol: "☴", element: "木" }, 6: { name: "坎", symbol: "☵", element: "水" },
    7: { name: "艮", symbol: "☶", element: "土" }, 8: { name: "坤", symbol: "☷", element: "土" }
};
// 【新增】定義八卦的爻線結構 (1代表陽爻, 0代表陰爻)
const trigramLines = {
    1: [1, 1, 1], // 乾
    2: [0, 1, 1], // 兌
    3: [1, 0, 1], // 離
    4: [0, 0, 1], // 震
    5: [1, 1, 0], // 巽
    6: [0, 1, 0], // 坎
    7: [1, 0, 0], // 艮
    8: [0, 0, 0]  // 坤
};
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

/**
 * 【升級】根據輸入的三個數字計算梅花易數的本卦、動爻與變卦
 * @param {object} numbers - 包含 num1, num2, num3 的物件
 * @returns {object} 包含本卦、動爻和變卦的完整資訊
 */
function getHexagramByNumbers(numbers) {
    const { num1, num2, num3 } = numbers;
    const upperNum = parseInt(num1) % 8 || 8;
    const lowerNum = parseInt(num2) % 8 || 8;
    const movingLine = (parseInt(num1) + parseInt(num2) + parseInt(num3)) % 6 || 6;
    
    const mainHexagramKey = `${upperNum}${lowerNum}`;

    // --- 計算變卦 (之卦) ---
    const mainUpperLines = [...trigramLines[upperNum]];
    const mainLowerLines = [...trigramLines[lowerNum]];
    const hexagramAllLines = [...mainLowerLines, ...mainUpperLines];

    // 根據動爻改變對應爻線的陰陽 (0變1, 1變0)
    const lineIndexToChange = movingLine - 1;
    hexagramAllLines[lineIndexToChange] = 1 - hexagramAllLines[lineIndexToChange];

    const changedLowerLines = hexagramAllLines.slice(0, 3);
    const changedUpperLines = hexagramAllLines.slice(3, 6);

    // 透過爻線結構反查對應的卦名數字
    const findTrigramNum = (lines) => {
        const linesStr = JSON.stringify(lines);
        for (const num in trigramLines) {
            if (JSON.stringify(trigramLines[num]) === linesStr) {
                return parseInt(num);
            }
        }
        return null;
    };

    const changedUpperNum = findTrigramNum(changedUpperLines);
    const changedLowerNum = findTrigramNum(changedLowerLines);
    
    let changedHexagramInfo = null;
    if (changedUpperNum != null && changedLowerNum != null) {
        const changedHexagramKey = `${changedUpperNum}${changedLowerNum}`;
        changedHexagramInfo = {
            name: hexagrams[changedHexagramKey] || "未知卦象",
            upper: trigrams[changedUpperNum],
            lower: trigrams[changedLowerNum]
        };
    }

    return {
        main: {
            name: hexagrams[mainHexagramKey] || "未知卦象",
            upper: trigrams[upperNum],
            lower: trigrams[lowerNum]
        },
        movingLine: movingLine,
        changed: changedHexagramInfo
    };
}

// --- 初始化 Google AI 客戶端 ---
let model;
if (process.env.GOOGLE_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest",
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
        });
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
        return res.status(503).json({ error: "AI 服務未配置或初始化失敗。" });
    }

    try {
        // 【修正】針對無伺服器環境的請求主體進行更穩健的處理
        let body = req.body;
        // 在某些 serverless 環境中，body 可能會是 string 格式，需要手動解析
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (e) {
                console.error("無法解析請求主體為 JSON:", body);
                return res.status(400).json({ error: "請求格式錯誤。" });
            }
        }

        const { question, poemTitle, poemText, numbers } = body;

        // 使用 '== null' 可以同時檢查 undefined 和 null，但允許 0 作為有效值
        if (!question || !poemTitle || !poemText || !numbers || numbers.num1 == null || numbers.num2 == null || numbers.num3 == null) {
            const errorMessage = `請求資料不完整，缺少必要欄位。收到的資料為: ${JSON.stringify(body)}`;
            console.error(errorMessage);
            return res.status(400).json({ error: "請求資料不完整，缺少必要欄位。" });
        }
        
        const hexagramsInfo = getHexagramByNumbers(numbers);
        
        // 檢查變卦是否成功計算
        if (!hexagramsInfo.changed) {
            console.error("變卦計算失敗，收到的卦象資訊:", hexagramsInfo);
            return res.status(500).json({ error: "伺服器內部錯誤：無法計算變卦。" });
        }

        // 【升級】將變卦資訊加入 Prompt
        const prompt = `
# 角色設定
你是一位專業的籤詩與易經解析大師。你的語氣應溫和、富有哲理且充滿智慧，能夠給予求籤者清晰的指引與心靈的慰藉。請多從正面角度提供建議，並以繁體中文回答。

# 背景資料
一位信眾前來求籤，以下是祂求得的所有資訊：
1. 所問之事: "${question}"
2. 依此數字推算的梅花易數卦象:
   - 起卦數字: 上卦 ${numbers.num1}，下卦 ${numbers.num2}，動爻 ${numbers.num3}
   - 本卦: ${hexagramsInfo.main.name} (上${hexagramsInfo.main.upper.name}${hexagramsInfo.main.upper.symbol}，下${hexagramsInfo.main.lower.name}${hexagramsInfo.main.lower.symbol})。這代表事情的「初始狀態」或「當前情勢」。
   - 動爻: 第 ${hexagramsInfo.movingLine} 爻。這是整個卦象中變化的關鍵。
   - 之卦 (變卦): ${hexagramsInfo.changed.name} (上${hexagramsInfo.changed.upper.name}${hexagramsInfo.changed.upper.symbol}，下${hexagramsInfo.changed.lower.name}${hexagramsInfo.changed.lower.symbol})。這代表事情的「未來趨勢」或「最終結果」。
3. 所抽籤詩:
   - 標題: ${poemTitle}
   - 內容: "${poemText}"

# 任務指令
請根據以上所有資訊，為這位信眾提供一次綜合性的、有深度的解析。你的解析需要包含以下幾個層次，且在最終輸出中，請不要使用任何星號 '*' 來產生粗體格式。

1. 卦象演變詳解:
   - 簡要說明「${hexagramsInfo.main.name}」(本卦) 的基本涵義，它如何反映所問之事的「現況」。
   - 接著說明由第 ${hexagramsInfo.movingLine} 爻變動後，所形成的「${hexagramsInfo.changed.name}」(之卦) 的涵義，它揭示了事情的「未來走向」。
   - 綜合分析從「本卦」到「之卦」的轉變過程，這個「變」的核心意義是什麼？它給了我們什麼樣的啟示？

2. 籤詩核心寓意:
   - 深入解讀「${poemTitle}」這首籤詩的字面與內在含義。籤詩中的關鍵意象（例如：龍、虎、風、雲、月、舟等）與卦象的演變有何關聯？

3. 綜合解析與建議:
   - 將「卦象的演變」與「籤詩的核心寓意」徹底結合，針對信眾提出的「${question}」這個具體問題，給出綜合性的回答。
   - 請將「機遇」、「挑戰」與「應對之道」作為獨立的段落標題，格式為：【標題名稱】。
   - 在「應對之道」中，提出具體的行動建議或心態調整方向，並嚴格使用條列式說明。每個條列項目前方需加上「一、」、「二、」、「三、」等編號，且每個條列項目都必須自成一個段落。
   - 最後，請以一段溫暖、充滿鼓勵與智慧的話語作結，給予信眾信心與希望。

請確保整體排版條理分明，文筆流暢優美，且各個主要段落之間僅以單一換行分隔。
`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysisResult = response.text();

        res.json({ 
            analysis: analysisResult,
            hexagram: hexagramsInfo 
        });

    } catch (error) {
        console.error("在 /analyze 路由處理時發生嚴重錯誤:", error);
        res.status(500).json({ 
            error: "AI 服務在處理您的請求時發生內部錯誤。",
            details: error.message 
        });
    }
});

app.use('/api', router);

module.exports.handler = serverless(app);
