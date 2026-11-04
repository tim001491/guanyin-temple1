// 菩提光球・線上光明燈 API
// 用 Netlify Functions + Netlify Blobs 存放大家點的燈，不需要另外申請資料庫。
//
//   GET  /api/lamps           取得光球裡最新的光明燈與統計數字
//   GET  /api/lamps?id=燈號    取得單一盞燈（分享連結用）
//   POST /api/lamps           { action: "light" | "bless" | "pray" | "remove", ... }
//
// 管理：在 Netlify 後台 Site configuration → Environment variables 新增 LAMP_ADMIN_KEY（自訂一組密碼），
// 之後打開 lamp.html#admin 輸入這組密碼，就能移除不當的祈願。

import { getStore } from "@netlify/blobs";

export const config = { path: "/api/lamps" };

const CATEGORIES = ["平安", "健康", "學業", "事業", "財運", "姻緣", "闔家", "消災"];
const NAME_MAX = 12; // 顯示名稱最多字數
const WISH_MAX = 60; // 祈願文最多字數
const WALL_MAX = 600; // 光球保留最新的燈數（更早的燈仍可用分享連結查看）
const LIST_MAX = 240; // 每次傳給網頁的燈數
const LIMITS = {
  light: { max: 8, windowMs: 60 * 60 * 1000 }, // 同一個網路來源一小時最多點 8 盞
  bless: { max: 60, windowMs: 10 * 60 * 1000 }, // 隨喜／祈福十分鐘最多 60 次
};
// 不適合公開的字詞，可以自行增加
const BLOCKED_WORDS = [
  "幹你", "幹妳", "操你", "肏", "靠北", "靠杯", "雞掰", "機掰", "去死", "死全家",
  "王八", "賤人", "婊子", "智障", "白痴", "白癡", "腦殘", "fuck", "shit", "bitch",
];

const WALL_KEY = "wall";
const ID_RE = /^[a-f0-9]{12}$/;
// 換一個名稱就等於清空光球重新開始（舊資料仍保留在原本的名稱下）
const STORE_NAME = "guangming-lamps-v2";
const WALL_EPOCH = 2;
const RATE_STORE_NAME = "guangming-rate";

function env(name) {
  try {
    const v = globalThis.Netlify?.env?.get?.(name);
    if (v) return v;
  } catch {}
  return process.env[name];
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

const fail = (status, error) => json({ ok: false, error }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emptyWall = () => ({ v: 1, total: 0, blessTotal: 0, lamps: [] });

// 去掉控制字元與多餘空白
function clean(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const length = (s) => Array.from(s).length;

// 網址、Email、LINE ID、電話號碼都不公開
function hasContact(text) {
  const t = text.normalize("NFKC").toLowerCase();
  if (/(https?:\/\/|www\.|\.(com|net|org|tw|cc|io|me|xyz|top|shop|info|link)\b)/.test(t)) return true;
  if (/line\s*(id)?\s*[:：]|加賴|加line|@[a-z0-9_.]{3,}/.test(t)) return true;
  const runs = t.match(/[\d\s\-()+]{9,}/g) || [];
  return runs.some((r) => (r.match(/\d/g) || []).length >= 9);
}

function hasBlockedWord(text) {
  const t = text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  return BLOCKED_WORDS.some((w) => t.includes(w.toLowerCase()));
}

async function hashIp(ip) {
  const data = new TextEncoder().encode(`${ip}|${env("LAMP_SALT") || "bodhi-orb"}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 簡單的頻率限制：太頻繁就請對方稍後再試
async function allow(kind, ip) {
  const limit = LIMITS[kind];
  const store = getStore({ name: RATE_STORE_NAME, consistency: "strong" });
  const key = `${kind}/${await hashIp(ip)}`;
  const now = Date.now();
  const prev = (await store.get(key, { type: "json" })) || [];
  const recent = (Array.isArray(prev) ? prev : []).filter((t) => now - t < limit.windowMs);
  if (recent.length >= limit.max) return false;
  recent.push(now);
  await store.setJSON(key, recent);
  return true;
}

// 讀出光球資料 → 修改 → 只有在沒人同時改過時才寫回，被搶先就重來
async function updateWall(store, mutate) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await store.getWithMetadata(WALL_KEY, { type: "json" });
    const wall = entry?.data && Array.isArray(entry.data.lamps) ? entry.data : emptyWall();
    const result = mutate(wall);
    if (result === false) return { wall, changed: false };
    const options = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const { modified } = await store.setJSON(WALL_KEY, wall, options);
    if (modified) return { wall, changed: true };
    await sleep(30 + Math.random() * 90 * (attempt + 1));
  }
  throw new Error("wall-busy");
}

function clientIp(req, context) {
  return (
    context?.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

async function handleGet(req) {
  const url = new URL(req.url);
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const id = url.searchParams.get("id");

  if (id !== null) {
    if (!ID_RE.test(id)) return fail(400, "燈號格式不正確");
    const wall = await store.get(WALL_KEY, { type: "json" });
    let lamp = wall?.lamps?.find((l) => l.id === id);
    if (!lamp) lamp = await store.get(`lamp/${id}`, { type: "json" });
    if (!lamp) return fail(404, "找不到這盞光明燈，可能已被移除");
    return json({ ok: true, lamp });
  }

  const wall = (await store.get(WALL_KEY, { type: "json" })) || emptyWall();
  return json(
    {
      ok: true,
      total: wall.total || 0,
      blessTotal: wall.blessTotal || 0,
      lamps: (wall.lamps || []).slice(0, LIST_MAX),
      epoch: WALL_EPOCH,
      now: Date.now(),
    },
    200,
    {
      // 讓 Netlify 的 CDN 暫存 15 秒，訪客多時也不會一直叫醒函式
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, s-maxage=15, stale-while-revalidate=60",
    }
  );
}

async function handleLight(body, ip) {
  if (clean(body.website)) return fail(400, "點燈失敗，請重新整理後再試");

  const name = clean(body.name);
  const wish = clean(body.wish);
  const cat = clean(body.cat);

  if (!name) return fail(400, "請填寫姓名或稱呼");
  if (length(name) > NAME_MAX) return fail(400, `姓名或稱呼請在 ${NAME_MAX} 字以內`);
  if (!CATEGORIES.includes(cat)) return fail(400, "請選擇祈願類別");
  if (length(wish) > WISH_MAX) return fail(400, `祈願文請在 ${WISH_MAX} 字以內`);
  if (hasContact(name) || hasContact(wish)) return fail(400, "為了保護您的隱私，請不要填寫網址、電話或聯絡帳號");
  if (hasBlockedWord(name) || hasBlockedWord(wish)) return fail(400, "內容有不適合公開的字詞，請修改後再點燈");
  if (!(await allow("light", ip))) return fail(429, "您剛剛已點了好幾盞燈，請稍後再點");

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const lamp = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    no: 0,
    name,
    cat,
    wish,
    t: Date.now(),
    b: 0,
  };

  const { wall } = await updateWall(store, (w) => {
    w.total = (w.total || 0) + 1;
    lamp.no = w.total;
    w.lamps.unshift(lamp);
    if (w.lamps.length > WALL_MAX) w.lamps.length = WALL_MAX;
  });

  // 每盞燈另外存一份，光球滿了以後，分享連結仍然找得到
  await store.setJSON(`lamp/${lamp.id}`, lamp, { onlyIfNew: true });
  // 刪除用的密碼只交給點燈的人，伺服器只存它的雜湊值
  const token = crypto.randomUUID().replace(/-/g, "");
  await store.set(`owner/${lamp.id}`, await sha256(token));
  return json({ ok: true, lamp, token, total: wall.total, blessTotal: wall.blessTotal || 0 });
}

async function handleBless(body, ip, { forAll }) {
  const id = forAll ? null : clean(body.id);
  if (!forAll && !ID_RE.test(id)) return fail(400, "燈號格式不正確");
  if (!(await allow("bless", ip))) return fail(429, "祈福的心意已收到，請稍後再試");

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  let blessed = null;
  const { wall, changed } = await updateWall(store, (w) => {
    if (!forAll) {
      blessed = w.lamps.find((l) => l.id === id);
      if (!blessed) return false;
      blessed.b = (blessed.b || 0) + 1;
    }
    w.blessTotal = (w.blessTotal || 0) + 1;
  });
  if (!forAll && !changed) return fail(404, "這盞燈已不在光球中");
  return json({ ok: true, id, b: blessed ? blessed.b : undefined, blessTotal: wall.blessTotal });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function removeLamp(store, id) {
  await updateWall(store, (w) => {
    const before = w.lamps.length;
    w.lamps = w.lamps.filter((l) => l.id !== id);
    if (w.lamps.length === before) return false;
  });
  await store.delete(`lamp/${id}`);
  await store.delete(`owner/${id}`);
}

// 點燈的人刪除自己的燈：要拿點燈時拿到的刪除密碼
async function handleDelete(body) {
  const id = clean(body.id);
  const token = typeof body.token === "string" ? body.token : "";
  if (!ID_RE.test(id) || !/^[a-f0-9]{32}$/.test(token)) return fail(400, "無法刪除這盞燈");
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const saved = await store.get(`owner/${id}`);
  if (!saved) return fail(404, "這盞燈已經不在光球中");
  if (saved !== (await sha256(token))) return fail(403, "只有點燈的人可以刪除這盞燈");
  await removeLamp(store, id);
  return json({ ok: true, id });
}

async function handleRemove(req, body) {
  const adminKey = env("LAMP_ADMIN_KEY");
  if (!adminKey) return fail(403, "尚未在 Netlify 設定 LAMP_ADMIN_KEY");
  if (req.headers.get("x-admin-key") !== adminKey) return fail(403, "管理密碼不正確");
  const id = clean(body.id);
  if (!ID_RE.test(id)) return fail(400, "燈號格式不正確");

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  await removeLamp(store, id);
  return json({ ok: true, id });
}

export default async (req, context) => {
  try {
    if (req.method === "GET") return await handleGet(req);
    if (req.method !== "POST") return fail(405, "不支援的請求");

    const text = await req.text();
    if (text.length > 4000) return fail(413, "內容太長了");
    let body;
    try {
      body = JSON.parse(text || "{}");
    } catch {
      return fail(400, "資料格式不正確");
    }
    const ip = clientIp(req, context);

    switch (body.action) {
      case "light":
        return await handleLight(body, ip);
      case "bless":
        return await handleBless(body, ip, { forAll: false });
      case "pray":
        return await handleBless(body, ip, { forAll: true });
      case "delete":
        return await handleDelete(body);
      case "remove":
        return await handleRemove(req, body);
      default:
        return fail(400, "不支援的動作");
    }
  } catch (err) {
    console.error("lamps api error", err);
    if (err && err.message === "wall-busy") return fail(503, "點燈的人太多了，請再按一次");
    return fail(500, "光明燈暫時無法連線，請稍後再試");
  }
};
