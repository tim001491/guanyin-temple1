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
const trigramLines = {
    1: [YANG, YANG, YANG], 2: [YANG, YANG, YIN],  3: [YANG, YIN,  YANG], 4: [YIN,  YIN,  YANG],
    5: [YIN,  YANG, YANG], 6: [YIN,  YANG, YIN],  7: [YANG, YIN,  YIN],  8: [YIN,  YIN,  YIN]
};
const linesToTrigramNum = Object.fromEntries(
  Object.entries(trigramLines).map(([num, lines]) => [lines.join(''), num])
);

// 干支五行對應表
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


// --- 初始化 Google AI 客戶端 ---
let model;
if (process.env.GOOGLE_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
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
        
        const { question, poemTitle, poemText, numbers, bazi } = parsedBody;

        if (!question || !poemTitle || !poemText || !numbers || !bazi || !bazi.dayPillar) {
            const errorMessage = `請求資料不完整，缺少必要欄位(question, poem, numbers, bazi)。收到的資料為: ${JSON.stringify(parsedBody)}`;
            console.error(errorMessage);
            return res.status(400).json({ error: errorMessage });
        }
        
        const hexagramsInfo = getHexagramByNumbers(numbers);
        
        const prompt = `
# 角色設定
你是一位精通《易經》、術數（包含四柱八字日課旺衰分析）、籤詩解讀的頂尖分析師。你的語氣應專業、客觀、中立且富有智慧。職責是深入剖析卦象與籤詩中的吉凶變化與義理，並結合問卜當下的時空能量（四柱干支），為求問者提供最精準的判斷與趨吉避凶的建議。請以繁體中文回答。

# 背景資料
一位信眾心中有所困惑，前來求得以下啟示：
1.  所問之事： "${question}"
2.  所抽籤詩：
    * 標題： ${poemTitle}
    * 內容： "${poemText}"
3.  依數字推算的易經卦象：
    * 本卦： ${hexagramsInfo.main.name} (上${hexagramsInfo.main.upper.name}${hexagramsInfo.main.upper.symbol} [${hexagramsInfo.main.upper.element}]，下${hexagramsInfo.main.lower.name}${hexagramsInfo.main.lower.symbol} [${hexagramsInfo.main.lower.element}])
    * 動爻： 第 ${hexagramsInfo.movingLine} 爻
    * 之卦 (變卦)： ${hexagramsInfo.changed.name} (上${hexagramsInfo.changed.upper.name}${hexagramsInfo.changed.upper.symbol} [${hexagramsInfo.changed.upper.element}]，下${hexagramsInfo.changed.lower.name}${hexagramsInfo.changed.lower.symbol} [${hexagramsInfo.changed.lower.element}])
4.  占卜日課 (完整四柱八字)：
    * 占卜公曆： ${bazi.gregorian}
    * 年柱： ${bazi.yearPillar} (年干${heavenlyStemsElements[bazi.yearPillar.charAt(0)]} / 年支${earthlyBranchesElements[bazi.yearPillar.charAt(1)]})
    * 月柱： ${bazi.monthPillar} (月干${heavenlyStemsElements[bazi.monthPillar.charAt(0)]} / 月支${earthlyBranchesElements[bazi.monthPillar.charAt(1)]})
    * 日柱 (日主)： ${bazi.dayPillar} (日干${heavenlyStemsElements[bazi.dayPillar.charAt(0)]} / 日支${earthlyBranchesElements[bazi.dayPillar.charAt(1)]})
    * 時柱： ${bazi.hourPillar} (時干${heavenlyStemsElements[bazi.hourPillar.charAt(0)]} / 時支${earthlyBranchesElements[bazi.hourPillar.charAt(1)]})

# 任務指令
請根據以上所有資訊，為信眾提供一次綜合性的專業解析。你的解析需包含以下層次。請勿在您的回覆中使用任何星號 '*' 來進行格式化。

【籤詩核心寓意】：
深入解讀「${poemTitle}」這首籤詩，並說明其意境如何與（已被日課影響的）卦象轉變相互印證。

【綜合卦象與日課總論】：
結合「本卦」、「動爻」與「之卦」，對所問之事給出一個整體的論斷。你必須分析卦象的「體卦」與「用卦」的五行，並結合「日柱」干支（${bazi.dayPillar}）的五行旺衰來進行論斷。分析日辰對卦中各五行是「生助扶持」（吉）還是「克洩耗」（凶），這會直接影響吉凶的真實程度。

給您的具體指引：
針對「${question}」，結合卦象與籤詩，給出綜合性的回答。請使用 【機緣與挑戰】： 和 【應對之道】： 作為段落標題。
* 在 【機緣與挑戰】： 中，客觀分析正面與負面的可能性。
* 在 【應對之道】： 中，以「一、」、「二、」等條列式提出具體建議。

【開運化煞錦囊】：
根據卦象五行與日課四柱的綜合平衡，提出趨吉避凶的建議，包含以下子項目：
* 核心五行分析： 點出當下最需要補強或調和的五行能量。
* 增運色彩： 根據五行分析，提出建議的幸運色系。
* 吉祥方位： 根據八卦對應的方位，指出對求問者有利的方向。
* 吉祥物品： 根據需要補強的五行，推薦一至兩樣具體、容易取得的開運物品（例如：水晶、植物、金屬飾品、香氛等）。
* 應避事項： 根據五行沖剋關係，簡要提醒應避免的顏色或方位。

【結語】：
以一段精鍊、沉穩且富含哲理的話語作結。

請確保整體排版條理分明，文筆流暢精準，且各個主要段落之間僅以單一換行分隔。
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