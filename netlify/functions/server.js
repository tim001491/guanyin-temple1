// 引入必要的套件
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
const serverless = require('serverless-http');
const lunar = require('lunar-calendar'); // *** 新增：引入農曆計算套件 ***

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
const trigramLines = {
    1: [YANG, YANG, YANG], 2: [YANG, YANG, YIN],  3: [YANG, YIN,  YANG], 4: [YIN,  YIN,  YANG],
    5: [YIN,  YANG, YANG], 6: [YIN,  YANG, YIN],  7: [YANG, YIN,  YIN],  8: [YIN,  YIN,  YIN]
};
const linesToTrigramNum = Object.fromEntries(
  Object.entries(trigramLines).map(([num, lines]) => [lines.join(''), num])
);

// *** 新增：干支五行對應表 ***
const heavenlyStemsElements = {
    '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水'
};
const earthlyBranchesElements = {
    '子': '水', '丑': '土', '寅': '木', '卯': '木', '辰': '土', '巳': '火', '午': '火', '未': '土', '申': '金', '酉': '金', '戌': '土', '亥': '水'
};


// --- 起卦與變卦計算函式 ---
function getHexagramByNumbers(numbers) {
    const { num1, num2, num3 } = numbers;
    
    const upperNum = parseInt(num1) % 8 || 8;
    const lowerNum = parseInt(num2) % 8 || 8;
    const movingLine = (parseInt(num1) + parseInt(num2) + parseInt(num3)) % 6 || 6;
    
    const mainHexagramKey = `${upperNum}${lowerNum}`;
    
    const lowerLines = [...trigramLines[lowerNum]];
    const upperLines = [...trigramLines[upperNum]];
    
    const hexagramLines = [...lowerLines, ...upperLines];
    
    const lineToChangeIndex = movingLine - 1;
    hexagramLines[lineToChangeIndex] = (hexagramLines[lineToChangeIndex] === YANG) ? YIN : YANG;
    
    const changedLowerLines = hexagramLines.slice(0, 3);
    const changedUpperLines = hexagramLines.slice(3, 6);
    
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

// *** 新增：取得今日干支與五行的函式 ***
function getDailyGanzhiInfo() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const lunarData = lunar.solarToLunar(year, month, day);
    const dayGan = lunarData.Gan;
    const dayZhi = lunarData.Zhi;
    const ganZhi = `${dayGan}${dayZhi}`;

    return {
        date: `${year}-${month}-${day}`,
        ganZhi: ganZhi,
        stem: { name: dayGan, element: heavenlyStemsElements[dayGan] },
        branch: { name: dayZhi, element: earthlyBranchesElements[dayZhi] }
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
        if (req.body instanceof Buffer) {
            parsedBody = JSON.parse(req.body.toString());
        }
        
        const { question, poemTitle, poemText, numbers } = parsedBody;

        if (!question || !poemTitle || !poemText || !numbers || numbers.num1 === undefined || numbers.num2 === undefined || numbers.num3 === undefined) {
            const errorMessage = `請求資料不完整，缺少必要欄位。收到的資料為: ${JSON.stringify(parsedBody)}`;
            console.error(errorMessage);
            return res.status(400).json({ error: errorMessage });
        }
        
        // 取得卦象資訊
        const hexagramsInfo = getHexagramByNumbers(numbers);
        // *** 新增：取得今日干支五行資訊 ***
        const dailyInfo = getDailyGanzhiInfo();
        
        // 【*** 全新優化，融入日課分析的 AI 提示 (Prompt) ***】
        const prompt = `
# 角色設定
你是一位精通《易經》、術數（包含日課旺衰分析）、籤詩解讀的頂尖分析師。
你的語氣應專業、客觀、中立且富有智慧。職責是深入剖析卦象與籤詩中的吉凶變化與義理，
並結合問卜當下的時空能量（日辰干支），為求問者提供最精準的判斷與趨吉避凶的建議。請以繁體中文回答。

# 背景資料
一位信眾心中有所困惑，前來求得以下啟示：
1.  **所問之事**: "${question}"
2.  **所抽籤詩**:
    * 標題: ${poemTitle}
    * 內容: "${poemText}"
3.  **依數字推算的易經卦象**:
    * **本卦**: ${hexagramsInfo.main.name} (上${hexagramsInfo.main.upper.name}${hexagramsInfo.main.upper.symbol} [${hexagramsInfo.main.upper.element}]，下${hexagramsInfo.main.lower.name}${hexagramsInfo.main.lower.symbol} [${hexagramsInfo.main.lower.element}]) - 代表事情目前的狀況與本質。
    * **動爻**: 第 ${hexagramsInfo.movingLine} 爻 - 是整個卦象中變化的關鍵，是變動的核心所在。
    * **之卦 (變卦)**: ${hexagramsInfo.changed.name} (上${hexagramsInfo.changed.upper.name}${hexagramsInfo.changed.upper.symbol} [${hexagramsInfo.changed.upper.element}]，下${hexagramsInfo.changed.lower.name}${hexagramsInfo.changed.lower.symbol} [${hexagramsInfo.changed.lower.element}]) - 代表事情未來的發展趨勢與最終可能的結果。
4.  **占卜日課 (時間背景)**:
    * **占卜日期**: ${dailyInfo.date}
    * **本日干支**: ${dailyInfo.ganZhi}
    * **本日五行**: 天干屬「${dailyInfo.stem.element}」，地支屬「${dailyInfo.branch.element}」。這是影響今日萬事萬物能量流動的關鍵時間因素。

# 任務指令
請根據以上所有資訊，為信眾提供一次綜合性的專業解析。你的解析需包含以下層次，
並確保最終輸出中，不要使用任何星號 '*' 來產生粗體格式。

1.  **綜合卦象總論**:
    請先結合「本卦」、「動爻」與「之卦」，對所問之事給出一個整體的、高度概括的論斷。說明從 ${hexagramsInfo.main.name} 轉化為 ${hexagramsInfo.changed.name} 的過程所揭示的「核心吉凶趨勢」。最重要的是，**你必須結合本日干支五行（天干${dailyInfo.stem.element}、地支${dailyInfo.branch.element}）與「本卦、之卦的五行」之間的生剋關係來進行論斷**，分析日辰對卦象的影響是「生助扶持」（吉）還是「克洩耗」（凶），這會直接影響吉凶的程度。

2.  **籤詩核心寓意**:
    接著，深入解讀「${poemTitle}」這首籤詩的內在含義。請說明籤詩的意境如何與（已被日辰影響的）卦象轉變相互印證，共同指向同一件事情的答案。

3.  **給您的具體指引**:
    將「卦象的轉變」與「籤詩的寓意」結合，針對信眾提出的「${question}」這個具體問題，給出綜合性的回答。請將「機緣與挑戰」與「應對之道」作為獨立的段落標題，格式為：【標題名稱】。
    * 在【機緣與挑戰】中，必須公正客觀地分析此事正面與負面的可能性，吉凶並陳。
    * 在【應對之道】中，提出具體的行動建議或心態調整方向，並嚴格使用條列式說明。每個條列項目前方需加上「一、」、「二、」、「三、」等編號，且每個條列項目都必須自成一個段落。

4.  **【開運化煞錦囊】**:
    根據本卦與之卦的五行生剋制化原理，並**充分考量今日干支的影響**，為求問者提供趨吉避凶的具體生活建議。此段落必須包含以下子項目：
    * **核心五行分析**: 簡要說明此卦象組合中的五行強弱，並結合今日干支五行，分析何種能量得到時令的加持（旺相），何種能量受到壓制（休囚），點出當下最需要補強或調和的能量。
    * **增運色彩**: 根據五行分析，提出建議的幸運色系。
    * **吉祥方位**: 根據八卦對應的方位，指出對求問者有利的方向。
    * **應避事項**: 根據五行沖剋關係，簡要提醒應避免的顏色或方位。

5.  **結語**:
    最後，請以一段精鍊、沉穩且富含哲理的話語作結，總結本次占問的核心智慧。

請確保整體排版條理分明，文筆流暢精準，且各個主要段落之間僅以單一換行分隔，以保持格式簡潔。
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
        res.status(500).json({ error: "AI 服務在處理您的請求時發生內部錯誤，請稍後再試。" });
    }
});

// 將路由正確掛載到 /api 路徑下
app.use('/api', router);

// 導出給 Serverless 環境使用
module.exports.handler = serverless(app);