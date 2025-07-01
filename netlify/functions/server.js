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

// --- 梅花易數常數與資料 ---
const trigrams = {
    1: { name: "乾", symbol: "☰", element: "金" }, 2: { name: "兌", symbol: "☱", element: "金" },
    3: { name: "離", symbol: "☲", element: "火" }, 4: { name: "震", symbol: "☳", element: "木" },
    5: { name: "巽", symbol: "☴", element: "木" }, 6: { name: "坎", symbol: "☵", element: "水" },
    7: { name: "艮", symbol: "☶", element: "土" }, 8: { name: "坤", symbol: "☷", element: "土" }
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

const YIN = '⚋';
const YANG = '─';
// 以 [底爻, 中爻, 上爻] 的順序定義爻的陰陽
const trigramLines = {
    1: [YANG, YANG, YANG], // 乾
    2: [YANG, YANG, YIN],  // 兌
    3: [YANG, YIN,  YANG], // 離
    4: [YIN,  YIN,  YANG], // 震
    5: [YIN,  YANG, YANG], // 巽
    6: [YIN,  YANG, YIN],  // 坎
    7: [YANG, YIN,  YIN],  // 艮
    8: [YIN,  YIN,  YIN]   // 坤
};
// 建立反向查詢表，從爻的組合找到卦的編號
const linesToTrigramNum = Object.fromEntries(
  Object.entries(trigramLines).map(([num, lines]) => [lines.join(''), num])
);


// --- 起卦與變卦計算函式 ---
function getHexagramByNumbers(numbers) {
    const { num1, num2, num3 } = numbers;
    
    // 1. 計算本卦與動爻
    const upperNum = parseInt(num1) % 8 || 8;
    const lowerNum = parseInt(num2) % 8 || 8;
    const movingLine = (parseInt(num1) + parseInt(num2) + parseInt(num3)) % 6 || 6;
    
    const mainHexagramKey = `${upperNum}${lowerNum}`;
    
    // 2. 計算之卦 (變卦)
    const lowerLines = [...trigramLines[lowerNum]]; // 複製陣列以避免修改原始常數
    const upperLines = [...trigramLines[upperNum]];
    
    // 組合成六爻 (由下至上，索引 0-5)
    const hexagramLines = [...lowerLines, ...upperLines];
    
    // 改變動爻 (動爻 1-6 對應索引 0-5)
    const lineToChangeIndex = movingLine - 1;
    hexagramLines[lineToChangeIndex] = (hexagramLines[lineToChangeIndex] === YANG) ? YIN : YANG;
    
    // 分割回變更後的上下卦
    const changedLowerLines = hexagramLines.slice(0, 3);
    const changedUpperLines = hexagramLines.slice(3, 6);
    
    // 查找變更後的卦編號與卦名
    const changedLowerNum = linesToTrigramNum[changedLowerLines.join('')];
    const changedUpperNum = linesToTrigramNum[changedUpperLines.join('')];
    const changedHexagramKey = `${changedUpperNum}${changedLowerNum}`;

    return {
        main: {
            name: hexagrams[mainHexagramKey] || "未知卦象",
            upper: trigrams[upperNum],
            lower: trigrams[lowerNum]
        },
        movingLine: movingLine,
        changed: {
            name: hexagrams[changedHexagramKey] || "未知卦象",
            upper: trigrams[changedUpperNum],
            lower: trigrams[changedLowerNum]
        }
    };
}

// --- 初始化 Google AI 客戶端 ---
let model;
if (process.env.GOOGLE_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
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
        // 處理 Vercel/Netlify 環境下 body 可能為 Buffer 的情況
        if (req.body instanceof Buffer) {
            parsedBody = JSON.parse(req.body.toString());
        }
        
        const { question, poemTitle, poemText, numbers } = parsedBody;

        if (!question || !poemTitle || !poemText || !numbers || numbers.num1 === undefined || numbers.num2 === undefined || numbers.num3 === undefined) {
            const errorMessage = `請求資料不完整，缺少必要欄位。收到的資料為: ${JSON.stringify(parsedBody)}`;
            console.error(errorMessage);
            return res.status(400).json({ error: errorMessage });
        }
        
        // 取得包含本卦與之卦的完整資訊
        const hexagramsInfo = getHexagramByNumbers(numbers);
        
        // 【*更新*】優化後的 AI 提示 (Prompt)
        const prompt = `
# 角色設定
你是一位精通籤詩與《易經》的專業分析師。語氣應溫和、富有哲理且充滿慈悲，能為求問者提供清晰的指引與心靈的慰藉。請多從正面角度給予建議，並以繁體中文回答。請勿使用「貧道」、「老朽」等自稱。

# 背景資料
一位信眾心中有所困惑，前來求得以下啟示：
1.  **所問之事**: "${question}"
2.  **所抽籤詩**:
    * 標題: ${poemTitle}
    * 內容: "${poemText}"
3.  **依數字推算的易經卦象**:
    * **本卦**: ${hexagramsInfo.main.name} (上${hexagramsInfo.main.upper.name}${hexagramsInfo.main.upper.symbol}，下${hexagramsInfo.main.lower.name}${hexagramsInfo.main.lower.symbol}) - 這代表了事情目前的狀況與本質。
    * **動爻**: 第 ${hexagramsInfo.movingLine} 爻 - 這是整個卦象中變化的關鍵，是變動的核心所在。
    * **之卦 (變卦)**: ${hexagramsInfo.changed.name} (上${hexagramsInfo.changed.upper.name}${hexagramsInfo.changed.upper.symbol}，下${hexagramsInfo.changed.lower.name}${hexagramsInfo.changed.lower.symbol}) - 這代表了事情未來的發展趨勢與最終可能的結果。

# 任務指令
請根據以上所有資訊，為信眾提供一次綜合性的解析。你的解析需包含以下層次，並確保最終輸出中，不要使用任何星號 '*' 來產生粗體格式。

1.  **綜合卦象總論**:
    請先結合「本卦」、「動爻」與「之卦」，對所問之事給出一個整體的、高度概括的論斷。說明從 ${hexagramsInfo.main.name} 經過第 ${hexagramsInfo.movingLine} 爻的變動，轉化為 ${hexagramsInfo.changed.name}，這個過程所揭示的核心啟示是什麼。

2.  **籤詩核心寓意**:
    接著，深入解讀「${poemTitle}」這首籤詩的內在含義。請說明籤詩的意境如何與卦象的轉變相互呼應，共同指向同一件事情的答案。

3.  **給您的具體指引**:
    將「卦象的轉變」與「籤詩的寓意」結合，針對信眾提出的「${question}」這個具體問題，給出綜合性的回答。請將「機緣與挑戰」與「應對之道」作為獨立的段落標題，格式為：【標題名稱】。
    * 在【機緣與挑戰】中，分析此事的機會點與潛在困難。
    * 在【應對之道】中，提出具體的行動建議或心態調整方向，並嚴格使用條列式說明。每個條列項目前方需加上「一、」、「二、」、「三、」等編號，且每個條列項目都必須自成一個段落。

4.  **結語**:
    最後，請以一段溫暖、充滿鼓勵與智慧的話語作結，給予信眾信心與希望。

請確保整體排版條理分明，文筆流暢優美，且各個主要段落之間僅以單一換行分隔，以保持格式簡潔。
`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysisResult = response.text();

        res.json({ 
            analysis: analysisResult,
            hexagram: hexagramsInfo // 將包含本卦與之卦的完整資訊回傳給前端
        });
    } catch (error) {
        console.error("在 /analyze 路由處理時發生嚴重錯誤:", error);
        res.status(500).json({ error: "AI 服務在處理您的請求時發生內部錯誤，請稍後再試。" });
    }
});

// 將路由正確掛載到 /api 路徑下
app.use('/api', router);

// 導出給 Serverless 環境使用
module.exports.handler = serverless(app);