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

// --- 梅花易數與五行常數 ---
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
        
        const { question, poemTitle, poemText, numbers, bazi } = parsedBody;

        if (!question || !poemTitle || !poemText || !numbers || !bazi || !bazi.dayPillar) {
            const errorMessage = `請求資料不完整，缺少必要欄位。`;
            console.error(errorMessage, JSON.stringify(parsedBody));
            return res.status(400).json({ error: errorMessage });
        }
        
        const hexagramsInfo = getHexagramByNumbers(numbers);
        
        const prompt = `
# 角色與目標
你是一位頂尖的易經術數整合分析師，擅長結合籤詩、卦象、日課，提供快速、深刻且實用的指引。請使用專業、沉穩的語氣，並以繁體中文回答。

# 背景資料
- 所問之事： "${question}"
- 所抽籤詩： ${poemTitle} - "${poemText}"
- 易經卦象：
    - 本卦 (現狀)： ${hexagramsInfo.main.name} (體卦五行: ${(hexagramsInfo.movingLine <= 3 ? hexagramsInfo.main.upper.element : hexagramsInfo.main.lower.element)})
    - 動爻 (關鍵)： 第 ${hexagramsInfo.movingLine} 爻
    - 之卦 (未來)： ${hexagramsInfo.changed.name}
- 占卜日課 (四柱八字)：
    - 年柱: ${bazi.yearPillar} | 月柱: ${bazi.monthPillar} | 日柱: ${bazi.dayPillar} | 時柱: ${bazi.hourPillar}

# 任務指令：
請嚴格按照以下結構，快速生成回應。每一段的解釋都必須簡潔有力。

**【籤詩與卦象整合解析】**
快速整合籤詩的三個層次（起、承、合）與卦象的三個階段（本卦、動爻、之卦），對所問之事「${question}」給出一個整體的趨勢分析。

**【綜合建議】**
基於以上分析，用一句話總結最核心的行動建議。

**【開運化煞錦囊】**
分析占卜日課的干支五行，如何影響卦象的「體卦」五行。基於此專業判斷，提出趨吉避凶的建議：
- **核心五行**：點出當下對您最有利的「喜用五行」（金、木、水、火、或土）。
- **開運建議**：圍繞此「喜用五行」，用條列式快速提供一項顏色、一項方位、及一項具體的吉祥物品（例如：白色水晶、西方、金屬飾品）。

# 限制
- 總字數嚴格控制在 600 字以內。
- 保持每個段落解釋精簡，不要過度展開。
- 直接開始回答，無需任何開場白。
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

// 將路由正確掛載。 '/api' 是您之前正常運作時的路徑。
app.use('/api', router);

// 導出給 Serverless 環境使用
module.exports.handler = serverless(app);