// 引入必要的套件
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
const serverless = require('serverless-http');
const lunar = require('lunar-calendar');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 專業級易經數據 ---
const trigrams = {
    1: { name: "乾", symbol: "☰", element: "金" }, 2: { name: "兌", symbol: "☱", element: "金" },
    3: { name: "離", symbol: "☲", element: "火" }, 4: { name: "震", symbol: "☳", element: "木" },
    5: { name: "巽", symbol: "☴", element: "木" }, 6: { name: "坎", symbol: "☵", element: "水" },
    7: { name: "艮", symbol: "☶", element: "土" }, 8: { name: "坤", symbol: "☷", element: "土" }
};
const hexagrams = { "11": "乾為天", "12": "天澤履", "13": "天火同人", "14": "天雷無妄", "15": "天風姤", "16": "天水訟", "17": "天山遁", "18": "天地否", "21": "澤天夬", "22": "兌為澤", "23": "澤火革", "24": "澤雷隨", "25": "澤風大過", "26": "澤水困", "27": "澤山咸", "28": "澤地萃", "31": "火天大有", "32": "火澤睽", "33": "離為火", "34": "火雷噬嗑", "35": "火風鼎", "36": "火水未濟", "37": "火山旅", "38": "火地晉", "41": "雷天大壯", "42": "雷澤歸妹", "43": "雷火豐", "44": "震為雷", "45": "雷風恆", "46": "雷水解", "47": "雷山小過", "48": "雷地豫", "51": "風天小畜", "52": "風澤中孚", "53": "風火家人", "54": "風雷益", "55": "巽為風", "56": "風水渙", "57": "風山漸", "58": "風地觀", "61": "水天需", "62": "水澤節", "63": "水火既濟", "64": "水雷屯", "65": "水風井", "66": "坎為水", "67": "水山蹇", "68": "水地比", "71": "山天大畜", "72": "山澤損", "73": "山火賁", "74": "山雷頤", "75": "山風蠱", "76": "山水蒙", "77": "艮為山", "78": "山地剝", "81": "地天泰", "82": "地澤臨", "83": "地火明夷", "84": "地雷復", "85": "地風升", "86": "地水師", "87": "地山謙", "88": "坤為地" };
const YIN = '⚋'; const YANG = '─';
const trigramLines = { 1: [YANG, YANG, YANG], 2: [YANG, YANG, YIN],  3: [YANG, YIN,  YANG], 4: [YIN,  YIN,  YANG], 5: [YIN,  YANG, YANG], 6: [YIN,  YANG, YIN],  7: [YANG, YIN,  YIN],  8: [YIN,  YIN,  YIN] };
const linesToTrigramNum = Object.fromEntries(Object.entries(trigramLines).map(([num, lines]) => [lines.join(''), num]));
const heavenlyStemsElements = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
const earthlyBranchesElements = { '子': '水', '丑': '土', '寅': '木', '卯': '木', '辰': '土', '巳': '火', '午': '火', '未': '土', '申': '金', '酉': '金', '戌': '土', '亥': '水' };
const earthlyBranchesNumbers = { '子': 1, '丑': 2, '寅': 3, '卯': 4, '辰': 5, '巳': 6, '午': 7, '未': 8, '申': 9, '酉': 10, '戌': 11, '亥': 12 };

// 【核心升級】納甲規則：為八純卦配置爻支
const trigramNayingMapping = {
    // 陽四卦
    '1': { branches: ['子', '寅', '辰', '午', '申', '戌'], baseElement: '金' }, // 乾
    '4': { branches: ['子', '寅', '辰', '午', '申', '戌'], baseElement: '木' }, // 震
    '6': { branches: ['寅', '辰', '午', '申', '戌', '子'], baseElement: '水' }, // 坎
    '7': { branches: ['辰', '午', '申', '戌', '子', '寅'], baseElement: '土' }, // 艮
    // 陰四卦
    '8': { branches: ['未', '巳', '卯', '丑', '亥', '酉'], baseElement: '土' }, // 坤
    '5': { branches: ['丑', '亥', '酉', '未', '巳', '卯'], baseElement: '木' }, // 巽
    '3': { branches: ['卯', '丑', '亥', '酉', '未', '巳'], baseElement: '火' }, // 離
    '2': { branches: ['巳', '卯', '丑', '亥', '酉', '未'], baseElement: '金' }  // 兌
};

// 輔助函式：為一個完整的卦（六爻）配置爻支和五行
function getHexagramLinesDetails(lowerTrigramNum, upperTrigramNum) {
    const lowerMapping = trigramNayingMapping[lowerTrigramNum];
    const upperMapping = trigramNayingMapping[upperTrigramNum];
    
    // 從下到上組合六個爻的地支
    const branches = [
        ...lowerMapping.branches.slice(0, 3),
        ...upperMapping.branches.slice(3, 6)
    ];

    return branches.map((branch, index) => ({
        line: index + 1,
        branch: branch,
        element: earthlyBranchesElements[branch]
    }));
}

function getHexagramByTime(bazi) {
    const { year, month, day, hour } = bazi;
    const yearNum = earthlyBranchesNumbers[year.charAt(1)];
    const monthNum = parseInt(month, 10);
    const dayNum = parseInt(day, 10);
    const hourNum = earthlyBranchesNumbers[hour];

    const upperNum = (yearNum + monthNum + dayNum) % 8 || 8;
    const lowerNum = (yearNum + monthNum + dayNum + hourNum) % 8 || 8;
    const movingLine = (yearNum + monthNum + dayNum + hourNum) % 6 || 6;
    
    const mainHexagramKey = `${upperNum}${lowerNum}`;
    
    const hexagramLines = [...trigramLines[lowerNum], ...trigramLines[upperNum]];
    const lineToChangeIndex = movingLine - 1;
    const originalLineType = hexagramLines[lineToChangeIndex];
    hexagramLines[lineToChangeIndex] = (originalLineType === YANG) ? YIN : YANG;
    
    const changedLowerNum = linesToTrigramNum[hexagramLines.slice(0, 3).join('')];
    const changedUpperNum = linesToTrigramNum[hexagramLines.slice(3, 6).join('')];
    const changedHexagramKey = `${changedUpperNum}${changedLowerNum}`;

    return {
        main: {
            name: hexagrams[mainHexagramKey],
            upper: trigrams[upperNum],
            lower: trigrams[lowerNum],
            lines: getHexagramLinesDetails(lowerNum, upperNum) // 安上本卦的爻支
        },
        movingLine: movingLine,
        changed: {
            name: hexagrams[changedHexagramKey],
            upper: trigrams[changedUpperNum],
            lower: trigrams[changedLowerNum],
            lines: getHexagramLinesDetails(changedLowerNum, changedUpperNum) // 安上之卦的爻支
        }
    };
}

function getDailyGanzhiInfo() {
    const today = new Date();
    const lunarData = lunar.solarToLunar(today.getFullYear(), today.getMonth() + 1, today.getDate());
    const dayGan = lunarData.Gan;
    const dayZhi = lunarData.Zhi;
    return {
        date: `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
        ganZhi: `${dayGan}${dayZhi}`,
        stem: { name: dayGan, element: heavenlyStemsElements[dayGan] },
        branch: { name: dayZhi, element: earthlyBranchesElements[dayZhi] }
    };
}

let model;
if (process.env.GOOGLE_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        console.log("AI 模型初始化成功。");
    } catch (e) { console.error("AI 模型初始化失敗:", e); }
} else {
    console.warn("警告：未提供 GOOGLE_API_KEY。");
}

const router = express.Router();
router.post('/analyze', async (req, res) => {
    if (!model) return res.status(503).json({ error: "AI 服務未配置或初始化失敗。" });

    try {
        const { question, poemTitle, poemText, bazi } = req.body instanceof Buffer ? JSON.parse(req.body.toString()) : req.body;

        if (!question || !poemTitle || !poemText || !bazi) {
            return res.status(400).json({ error: `請求資料不完整: ${JSON.stringify(req.body)}` });
        }
        
        const hexagramsInfo = getHexagramByTime(bazi);
        const dailyInfo = getDailyGanzhiInfo();
        
        // 輔助函式：將爻支資訊格式化為字串
        const formatLines = (lines) => lines.map(l => `第${l.line}爻: ${l.branch}${l.element}`).join('，');

        // 【最終版 AI Prompt】
        const prompt = `
# 角色設定
你是一位頂尖的文王卦解卦宗師，深諳納甲、日課旺衰、五行生剋制化之理。你的分析必須專業、嚴謹、深入，直指核心。

# 背景資料
1.  **所問之事**: "${question}"
2.  **所抽籤詩**: 標題: ${poemTitle}，內容: "${poemText}"
3.  **占卜時間**: ${dailyInfo.date}
4.  **本日日辰**: ${dailyInfo.ganZhi} (天干屬${dailyInfo.stem.element}，地支屬${daily.branch.element})。此為衡量卦中萬物旺衰的最高權威。
5.  **依時間起卦結果**:
    * **本卦**: ${hexagramsInfo.main.name}。
        * 六爻納甲: ${formatLines(hexagramsInfo.main.lines)}
    * **動爻**: 第 ${hexagramsInfo.movingLine} 爻。
    * **之卦**: ${hexagramsInfo.changed.name}。
        * 六爻納甲: ${formatLines(hexagramsInfo.changed.lines)}

# 任務指令
請嚴格按照以下結構，對此次占問進行一次抽絲剝繭的專業級分析。不要使用任何星號 '*' 產生粗體。

1.  **日課與卦象總論**:
    首先，對「${dailyInfo.ganZhi}日」這個日辰能量做一個定性分析。然後，概括說明本卦「${hexagramsInfo.main.name}」變為之卦「${hexagramsInfo.changed.name}」所揭示的核心趨勢。**此處必須點出日辰干支對整個卦的總體影響是扶助還是抑制。**

2.  **逐爻旺衰精解**:
    這是分析的核心。請條列式分析「日辰」(${dailyInfo.ganZhi})對「本卦」中每一爻的生、剋、沖、合關係，並明確指出每一爻的旺衰狀態。格式如下，吉凶並陳：
    * 初爻 ${hexagramsInfo.main.lines[0].branch}${hexagramsInfo.main.lines[0].element}：(分析與日辰的關係，判斷旺、相、休、囚、死)。
    * 二爻 ${hexagramsInfo.main.lines[1].branch}${hexagramsInfo.main.lines[1].element}：(同上)。
    * ...以此類推至上爻。
    * **特別點評動爻**：深入分析第 ${hexagramsInfo.movingLine} 爻的旺衰及其發動的影響。

3.  **用神與吉凶論斷**:
    根據所問之事「${question}」，確定卦中的「用神」(例如問財看妻財爻，問事業看官鬼爻)。然後結合用神之爻的旺衰狀態，以及動爻的影響，對事情的最終吉凶給出一個明確、直接的判斷。

4.  **籤詩與卦象互證**:
    解讀「${poemTitle}」籤詩的意境，並說明它如何從另一個維度印證了你從卦象分析中得出的吉凶結論。

5.  **【趨吉避凶錦囊】**:
    基於以上所有分析，給出具體、可操作的建議。
    * **應對之道**: 條列式說明現在應該採取的行動或心態。
    * **開運建議**: 根據卦中五行喜忌，提出有利的顏色、方位或生活建議。

請確保整體分析邏輯嚴密，環環相扣，從日辰到卦象，再到爻，最終落實到具體建議。
`;
        
        const result = await model.generateContent(prompt);
        const analysisResult = (await result.response).text();

        res.json({ analysis: analysisResult, hexagram: hexagramsInfo });
    } catch (error) {
        console.error("在 /analyze 路由處理時發生嚴重錯誤:", error);
        res.status(500).json({ error: "AI 服務在處理您的請求時發生內部錯誤。" });
    }
});

app.use('/api', router);
module.exports.handler = serverless(app);