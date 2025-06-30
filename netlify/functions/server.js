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
// 這個中介軟體仍然需要，以應對某些情況
app.use(express.json());

// --- 梅花易數計算模組 (保持不變) ---
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

// --- 【修改】根據數字起卦的函式 ---
function getHexagramByNumbers(numbers) {
    const { num1, num2, movingLine } = numbers;
    // 將使用者輸入的數字取餘數，對應到八卦。若為8的倍數則取8。
    const upperNum = parseInt(num1) % 8 || 8;
    const lowerNum = parseInt(num2) % 8 || 8;
    const mainHexagramKey = `${upperNum}${lowerNum}`;
    return {
        main: {
            name: hexagrams[mainHexagramKey] || "未知卦象",
            upper: trigrams[upperNum],
            lower: trigrams[lowerNum]
        },
        movingLine: parseInt(movingLine)
    };
}


// 初始化 Google AI 客戶端
let model;
if (process.env.GOOGLE_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
} else {
    console.warn("警告：未提供 GOOGLE_API_KEY。AI 功能將無法使用。");
}

const router = express.Router();

router.post('/analyze', async (req, res) => {
    if (!model) {
        return res.status(503).json({ error: "AI 服務未配置，請檢查伺服器環境變數。" });
    }
    try {
        let parsedBody = req.body;
        if (req.body instanceof Buffer) {
            parsedBody = JSON.parse(req.body.toString());
        }

        const { question, poemTitle, poemText, numbers } = parsedBody;

        if (!question || !poemTitle || !poemText || !numbers) {
            console.error("請求資料不完整:", parsedBody);
            return res.status(400).json({ error: `請求資料不完整，缺少必要欄位 (question, poemTitle, poemText, numbers)。收到的資料為: ${JSON.stringify(parsedBody)}` });
        }
        
        const hexagramsInfo = getHexagramByNumbers(numbers);
        
        // 【重要】更新傳送給 AI 的 prompt 以調整格式
        const prompt = `
# 角色設定
你是一位專業的籤詩與易經解析大師。你的語氣應溫和、富有哲理且充滿智慧，能夠給予求籤者清晰的指引與心靈的慰藉。請多從正面角度提供建議，並以繁體中文回答。在回答中，請避免使用「貧道」、「老朽」等自稱。

# 背景資料
一位信眾前來求籤，以下是祂求得的所有資訊：
1.  所問之事: "${question}"
2.  依此數字推算的梅花易數卦象:
    - 起卦數字: 上卦 ${numbers.num1}，下卦 ${numbers.num2}
    - 本卦: ${hexagramsInfo.main.name} (上${hexagramsInfo.main.upper.name}${hexagramsInfo.main.upper.symbol}，下${hexagramsInfo.main.lower.name}${hexagramsInfo.main.lower.symbol})
    - 動爻: 第 ${hexagramsInfo.movingLine} 爻
3.  所抽籤詩:
    - 標題: ${poemTitle}
    - 內容: "${poemText}"

# 任務指令
請根據以上所有資訊，為這位信眾提供一次綜合性的解析。你的解析需要包含以下幾個層次，且在最終輸出中，請不要使用任何星號 '*' 來產生粗體格式。

1.  數字卦象分析:
    - 簡要說明「${hexagramsInfo.main.name}」這個本卦的基本涵義。
    - 根據第 ${hexagramsInfo.movingLine} 動爻的位置，分析此卦象的「變動趨勢」，並說明它如何與所問之事對應。
2.  籤詩核心寓意:
    - 深入解讀「${poemTitle}」這首籤詩的字面與內在含義。籤詩中的關鍵詞（例如：龍、虎、風、雲、月、舟等）代表了什麼象徵意義？
3.  綜合解析與建議:
    - 將「卦象的變動趨勢」與「籤詩的核心寓意」結合，針對信眾提出的「${question}」這個具體問題，給出綜合性的回答。
    - 請將「機遇」、「挑戰」與「應對之道」作為獨立的段落標題，格式為：【標題名稱】，例如：【機遇】。標題下方為該項目的詳細說明。
    - 提出具體的行動建議或心態調整方向，並嚴格使用「一、」、「二、」、「三、」的格式進行條列式說明，標號後方加上一個冒號「：」。
    - 最後，請以一段溫暖、充滿鼓勵與智慧的話語作結，給予信眾信心與希望。

請確保整體排版條理分明，文筆流暢優美。
`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysisResult = response.text();
        res.json({ 
            analysis: analysisResult,
            hexagram: hexagramsInfo 
        });
    } catch (error) {
        console.error("後端函式處理時發生錯誤:", error);
        res.status(500).json({ error: "AI 服務發生錯誤，請稍後再試。" });
    }
});

app.use('/api', router);

module.exports.handler = serverless(app);
