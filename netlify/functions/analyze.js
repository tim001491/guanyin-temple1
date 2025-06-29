// 引入必要的套件
// 注意：我們不再需要 express, cors, dotenv
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 梅花易數計算模組 (這部分完全不變，直接複製過來) ---
const trigrams = {
    1: { name: "乾", symbol: "☰", element: "金" },
    2: { name: "兌", symbol: "☱", element: "金" },
    3: { name: "離", symbol: "☲", element: "火" },
    4: { name: "震", symbol: "☳", element: "木" }, // 【修正】這裡原本是句點(.)，會造成語法錯誤，已修正為冒號(:)
    5: { name: "巽", symbol: "☴", element: "木" },
    6: { name: "坎", symbol: "☵", element: "水" },
    7: { name: "艮", symbol: "☶", element: "土" },
    8: { name: "坤", symbol: "☷", element: "土" }
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

function getPlumBlossomHexagrams(bazi) {
    const { year, month, day, hour } = bazi;
    const yearNum = parseInt(year.match(/\d+/g) ? year.match(/\d+/g)[0] : "1");
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);
    const hourNum = parseInt(hour.match(/\d+/g) ? hour.match(/\d+/g)[0] : "1");
    const upperNum = (yearNum + monthNum + dayNum) % 8 || 8;
    const lowerNum = (yearNum + monthNum + dayNum + hourNum) % 8 || 8;
    const movingLine = (yearNum + monthNum + dayNum + hourNum) % 6 || 6;
    const mainHexagramKey = `${upperNum}${lowerNum}`;
    const mainHexagramName = hexagrams[mainHexagramKey];
    const mainUpperTrigram = trigrams[upperNum];
    const mainLowerTrigram = trigrams[lowerNum];
    return {
        main: {
            name: mainHexagramName,
            upper: mainUpperTrigram,
            lower: mainLowerTrigram
        },
        movingLine: movingLine
    };
}


// --- Netlify Function 主體 ---
// 所有 Netlify Function 都必須使用這個固定的格式
exports.handler = async (event, context) => {

    // 【優化】只處理 POST 請求，對於其他方法直接回絕
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // Method Not Allowed
            body: JSON.stringify({ error: '僅允許 POST 請求' }),
            headers: { 'Allow': 'POST' } 
        };
    }

    // 初始化 Google AI 客戶端
    // 注意：我們直接從 process.env 讀取，Netlify 會自動載入環境變數
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error("錯誤：未設定 GOOGLE_API_KEY 環境變數。");
        return { 
            statusCode: 503, // Service Unavailable
            body: JSON.stringify({ error: "AI 服務未配置，請聯絡網站管理員。" }) 
        };
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    try {
        // 從 event.body 取得前端傳來的資料
        // 因為 event.body 是字串，需要用 JSON.parse() 轉換成物件
        const { question, poemTitle, poemText, bazi } = JSON.parse(event.body);
        
        // 驗證輸入
        if (!question || !poemTitle || !poemText || !bazi) {
            return { 
                statusCode: 400, // Bad Request
                body: JSON.stringify({ error: "請求資料不完整，缺少 question, poemTitle, poemText 或 bazi。" }) 
            };
        }

        // 1. 進行梅花易數計算
        const hexagramsInfo = getPlumBlossomHexagrams(bazi);
        
        // 2. 建立給 AI 的提示 (Prompt) 
        const prompt = `
# 角色設定
你是一位專業的籤詩與易經解析大師。你的語氣應溫和、富有哲理且充滿智慧，能夠給予求籤者清晰的指引與心靈的慰藉。請多從正面角度提供建議，並以繁體中文回答。

# 背景資料
一位信眾前來求籤，以下是祂求得的所有資訊：

1.  **所問之事**: "${question}"
2.  **求籤時間四柱 (僅供參考)**:
    - 年: ${bazi.year}, 月: ${bazi.month}, 日: ${bazi.day}, 時: ${bazi.hour}
3.  **依此時間推算的梅花易數卦象**:
    - **本卦**: **${hexagramsInfo.main.name}** (上${hexagramsInfo.main.upper.name} ${hexagramsInfo.main.upper.symbol}，下${hexagramsInfo.main.lower.name} ${hexagramsInfo.main.lower.symbol})
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

        // 4. 將解析結果以 JSON 格式回傳給前端
        return {
            statusCode: 200, // OK
            body: JSON.stringify({ analysis: analysisResult })
        };

    } catch (error) {
        console.error("後端 Function 執行錯誤:", error);
        // 【優化】在回傳給使用者的錯誤訊息中，避免透露過多內部細節
        return { 
            statusCode: 500, // Internal Server Error
            body: JSON.stringify({ error: "AI 服務發生內部錯誤，請稍後再試。" }) 
        };
    }
};
