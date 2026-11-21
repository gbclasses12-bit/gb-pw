import express from "express";
import https from "node:https";
import zlib from "node:zlib";
import path from "node:path";
import fs from "node:fs";
const app = express();
const TARGET_HOST = "www.learnxpw.site";
const TARGET_ORIGIN = `https://${TARGET_HOST}`;
const PWMARCO_HOST = "web.pwmarco.xyz";
const PWMARCO_ORIGIN = `https://${PWMARCO_HOST}`;
const BRAND_NAME = "GB STUDY";
const TELEGRAM_URL = "https://t.me/GBFreestudy";
const ICON_URL = "https://i.ibb.co/Q3g9fGSt/1791541921524.png";
const OLD_ICON_URL = "https://i.ibb.co/V8CbjrG/image.png";
const OLD_TG_URL = "https://t.me/+AgMz8cG-x8VmNGY1";
const OLD_TG_URL_ALT = "https://t.me/AgMz8cG-x8VmNGY1";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 6e4,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 3e4
});
const staticAssetCache = /* @__PURE__ */ new Map();
const pageCache = /* @__PURE__ */ new Map();
let cachedAccessCookie = "studymeta_access=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImZ1bGwiLCJpYXQiOjE3OTM2MjM4ODAsImV4cCI6MTc5MzcxMDI4MH0.RRjEAcW3pPiuWyKF6EDDgK0epLc-gCLCVMna1DFk_nA";
let refreshPromise = null;
const CACHE_TTL_MS = 15 * 60 * 1e3;
const batchInfoCache = /* @__PURE__ */ new Map();
const subjectInfoCache = /* @__PURE__ */ new Map();
const topicInfoCache = /* @__PURE__ */ new Map();
const allBatchesCache = /* @__PURE__ */ new Map();
const lxExistenceCache = /* @__PURE__ */ new Map();
const searchSeenCache = /* @__PURE__ */ new Map();
const videoMetaCache = /* @__PURE__ */ new Map();
const pdfMetaCache = /* @__PURE__ */ new Map();
const pwmarcoClearKeyCache = /* @__PURE__ */ new Map();
let pwmarcoGuestCookie = "";
let pwmarcoSvsCookie = "";
let pwmarcoAuthPromise = null;

function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(""));
  });
}

async function getPwmarcoGuestCookie(forceRefresh = false) {
  if (pwmarcoGuestCookie && !forceRefresh) return pwmarcoGuestCookie;
  if (!pwmarcoAuthPromise || forceRefresh) {
    pwmarcoAuthPromise = (async () => {
      try {
        const res = await fetch(`${PWMARCO_ORIGIN}/api/auth/check`, {
          headers: {
            "user-agent": CHROME_UA,
            origin: PWMARCO_ORIGIN
          }
        });
        const setCookies = typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
        for (const sc of setCookies) {
          const m = sc && sc.match(/guest_id=[^;,\s]+/);
          if (m) {
            pwmarcoGuestCookie = m[0];
            return pwmarcoGuestCookie;
          }
        }
      } catch (err) {
        console.warn("[pwmarco] Failed to obtain guest cookie:", err?.message || err);
      }
      return pwmarcoGuestCookie;
    })().finally(() => {
      pwmarcoAuthPromise = null;
    });
  }
  return pwmarcoAuthPromise;
}

function getPwmarcoCookieHeader() {
  return [pwmarcoGuestCookie, pwmarcoSvsCookie].filter(Boolean).join("; ");
}

function b64UrlToUint8(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function decryptPwmarcoPayload(payload) {
  if (!payload || !payload.n || !payload.i || !payload.d) return payload;
  try {
    const nonce = b64UrlToUint8(payload.n);
    const salt = new TextEncoder().encode("pwm-env-7c1e");
    const combined = new Uint8Array(nonce.length + salt.length);
    combined.set(nonce, 0);
    combined.set(salt, nonce.length);
    const hash = await globalThis.crypto.subtle.digest("SHA-256", combined);
    const key = await globalThis.crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64UrlToUint8(payload.i) },
      key,
      b64UrlToUint8(payload.d)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (err) {
    console.warn("[pwmarco] AES-GCM decrypt failed:", err?.message || err);
    return null;
  }
}

async function fetchPwmarco(pathWithQuery, options = {}, retry = false) {
  const cookie = await getPwmarcoGuestCookie(retry);
  const fullCookie = [cookie, pwmarcoSvsCookie].filter(Boolean).join("; ");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 1e4);
  try {
    const res = await fetch(`${PWMARCO_ORIGIN}${pathWithQuery}`, {
      method: options.method || "GET",
      headers: {
        "user-agent": CHROME_UA,
        origin: PWMARCO_ORIGIN,
        referer: options.referer || `${PWMARCO_ORIGIN}/study/batches`,
        ...(fullCookie ? { cookie: fullCookie } : {}),
        ...(options.headers || {})
      },
      body: options.body,
      signal: controller.signal
    });
    const setCookies = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    for (const sc of setCookies) {
      if (sc && sc.startsWith("_svs=") && !sc.startsWith("_svs=;")) {
        const val = sc.split(";")[0];
        if (val && val.length > 5) pwmarcoSvsCookie = val;
      }
      if (sc && sc.startsWith("guest_id=")) {
        pwmarcoGuestCookie = sc.split(";")[0];
      }
    }
    if ((res.status === 401 || res.status === 403) && !retry) {
      pwmarcoGuestCookie = "";
      return fetchPwmarco(pathWithQuery, options, true);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPwmarcoJson(pathWithQuery, options = {}) {
  try {
    const res = await fetchPwmarco(pathWithQuery, options);
    const text = await res.text();
    const data = JSON.parse(text);
    return { status: res.status, data };
  } catch {
    return { status: 500, data: null };
  }
}

function normalizePwmarcoBatch(b) {
  if (!b || typeof b !== "object") return b;
  const id = String(b._id || b.batchId || b.id || "");
  const name = String(b.batchName || b.name || "Batch");
  let img = String(b.batchImage || b.previewImage || "").trim();
  if (!img || !img.startsWith("http")) img = ICON_URL;
  const price = Number(b.batchPrice ?? b.feeTotal ?? b.fee?.total ?? 0);
  const template = String(b.template || b.type || "NORMAL");
  return {
    ...b,
    _id: id,
    batchId: id,
    name,
    batchName: name,
    previewImage: img,
    batchImage: img,
    feeTotal: price,
    batchPrice: price,
    type: template,
    template
  };
}

function normalizePwmarcoBatchDetails(d, batchId) {
  if (!d || typeof d !== "object") return d;
  const name = String(d.name || d.batchName || "Batch");
  let img = String(d.previewImage || d.batchImage || "").trim();
  if (!img || !img.startsWith("http")) img = ICON_URL;
  const price = Number(d.feeTotal ?? d.batchPrice ?? d.fee?.total ?? 0);
  return {
    ...d,
    _id: String(d._id || batchId || ""),
    name,
    batchName: name,
    previewImage: img,
    batchImage: img,
    feeTotal: price,
    batchPrice: price
  };
}

function normalizeTopicItems(items, batchId, subjectId) {
  if (!Array.isArray(items)) return items;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const itemId = String(item._id || "");
    const vid = String(item.videoDetails?._id || item.videoDetails?.id || "");
    if (itemId) {
      const prev = videoMetaCache.get(itemId);
      const rawSubjId = String(item.batchSubjectId || item.subjectId?._id || "");
      const rawSubjSlug = String(item.subjectId?.slug || "");
      const argSubj = String(subjectId || "");
      videoMetaCache.set(itemId, {
        batchId: String(batchId || item.batchId || prev?.batchId || ""),
        subjectId: rawSubjId || (!argSubj.includes("-") ? argSubj : "") || prev?.subjectId || argSubj,
        subjectSlug: rawSubjSlug || (argSubj.includes("-") ? argSubj : "") || prev?.subjectSlug || "",
        videoId: vid || prev?.videoId || "",
        startTime: String(item.startTime || prev?.startTime || ""),
        urlType: String(item.urlType || item.scheduleType || prev?.urlType || ""),
        tag: String(item.tag || prev?.tag || "")
      });
    }
    const hws = Array.isArray(item.homeworkIds) ? item.homeworkIds : (item.homeworkIds ? [item.homeworkIds] : []);
    for (const hw of hws) {
      if (!hw || typeof hw !== "object") continue;
      const hwId = String(hw._id || "");
      const atts = Array.isArray(hw.attachmentIds) ? hw.attachmentIds : [];
      for (const att of atts) {
        if (!att || typeof att !== "object") continue;
        if (typeof att.baseUrl === "string" && att.baseUrl.includes("cors.testfile.eu.org/static.pw.live/")) {
          att.baseUrl = att.baseUrl.replace("https://cors.testfile.eu.org/static.pw.live/", "https://static.pw.live/");
        }
        const attId = String(att._id || "");
        if (attId && hwId) {
          pdfMetaCache.set(attId, {
            batchId: String(batchId || ""),
            subjectId: String(subjectId || ""),
            pdfId: itemId,
            homeworkId: hwId,
            baseUrl: att.baseUrl || "",
            key: att.key || "",
            name: att.name || ""
          });
        }
      }
    }
  }
  return items;
}

async function existsInLearnxpw(batchId, batchName) {
  if (!batchId) return true;
  if (lxExistenceCache.has(batchId)) return lxExistenceCache.get(batchId);
  if (!batchName) return false;
  try {
    const res = await fetchWithAuth(
      `${TARGET_ORIGIN}/api/searchBatch?name=${encodeURIComponent(batchName)}&page=1`,
      `${TARGET_ORIGIN}/study/batches`
    );
    if (res.status === 200 && res.body) {
      const parsed = JSON.parse(res.body);
      const found = Array.isArray(parsed?.batches) && parsed.batches.some((b) => String(b._id) === String(batchId));
      lxExistenceCache.set(batchId, found);
      return found;
    }
  } catch {
  }
  return true;
}

async function fetchPwmarcoPrimaryStream({ batchId, subjectId, subjectSlug, contentId, videoId, format = "hls" }) {
  const subjCandidates = [...new Set([subjectId, subjectSlug].map((s) => String(s || "").trim()).filter(Boolean))];
  if (!batchId || subjCandidates.length === 0 || !contentId) return null;
  for (const subj of subjCandidates) {
    const referer = `${PWMARCO_ORIGIN}/watch?batchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subj)}&ChildId=${encodeURIComponent(contentId)}&Type=penpencilvdo`;
    const attempts = [];
    if (videoId && videoId !== contentId) {
      attempts.push({ lectureId: videoId, altLectureId: contentId, scheduleId: contentId });
    }
    attempts.push({ lectureId: contentId, altLectureId: "", scheduleId: contentId });
    for (const att of attempts) {
      const qs = new URLSearchParams({
        batchId,
        subjectId: subj,
        lectureId: att.lectureId,
        altLectureId: att.altLectureId,
        scheduleId: att.scheduleId
      });
      if (format) qs.set("format", format);
      const { status, data } = await fetchPwmarcoJson(`/api/primary-stream?${qs.toString()}`, { referer });
      if (status === 200 && data && data.n && data.i && data.d) {
        const dec = await decryptPwmarcoPayload(data);
        if (dec && dec.success && (dec.src || dec.dash)) {
          return dec;
        }
      }
    }
  }
  return null;
}

async function fetchPwmarcoLiveUrl({ batchId, subjectId, subjectSlug, contentId, startTime }) {
  const subjCandidates = [...new Set([subjectId, subjectSlug].map((s) => String(s || "").trim()).filter(Boolean))];
  if (!batchId || subjCandidates.length === 0 || !contentId) return null;
  for (const subj of subjCandidates) {
    const qs = new URLSearchParams({
      batchId,
      subjectId: subj,
      childId: contentId,
      container: "HLS"
    });
    if (startTime) qs.set("startTime", startTime);
    const referer = `${PWMARCO_ORIGIN}/live?batchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subj)}&ChildId=${encodeURIComponent(contentId)}`;
    const { status, data } = await fetchPwmarcoJson(`/api/get-live-url?${qs.toString()}`, { referer });
    if (status === 200 && data?.success && (data?.fullUrl || data?.url)) {
      const rawUrl = String(data.fullUrl || (String(data.url || "") + String(data.signedUrl || ""))).trim();
      if (!rawUrl) continue;
      const qIdx = rawUrl.indexOf("?");
      const baseUrl = qIdx !== -1 ? rawUrl.slice(0, qIdx) : rawUrl;
      const signedUrl = qIdx !== -1 ? rawUrl.slice(qIdx) : String(data.signedUrl || "");
      return {
        fullUrl: rawUrl,
        baseUrl,
        signedUrl,
        isPwmarcoV: rawUrl.startsWith("/api/v/")
      };
    }
  }
  return null;
}

function rewriteM3u8Urls(m3u8Text, basePlaylistUrlStr) {
  try {
    const baseU = new URL(basePlaylistUrlStr);
    const baseSearch = baseU.search;
    const resolveRef = (ref) => {
      const trimmed = ref.trim();
      if (!trimmed || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
        return trimmed;
      }
      const resolved = new URL(trimmed, baseU);
      if (!resolved.search && baseSearch) resolved.search = baseSearch;
      return resolved.toString();
    };
    return m3u8Text
      .split(/\r?\n/)
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith("#")) {
          return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${resolveRef(u)}"`);
        }
        return resolveRef(t);
      })
      .join("\n");
  } catch {
    return m3u8Text;
  }
}

async function fetchLearnxpwPost(path, rawBody, refererPath = "/study/batches") {
  const accessCookie = await getAccessCookie();
  return new Promise((resolve) => {
    const req = https.request(
      `${TARGET_ORIGIN}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": CHROME_UA,
          origin: TARGET_ORIGIN,
          referer: `${TARGET_ORIGIN}${refererPath}`,
          cookie: accessCookie
        },
        agent: keepAliveAgent
      },
      (proxyRes) => {
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          resolve({
            status: proxyRes.statusCode || 500,
            body: Buffer.concat(chunks).toString("utf-8")
          });
        });
      }
    );
    req.setTimeout(8e3, () => {
      req.destroy();
      resolve({ status: 504, body: "" });
    });
    req.on("error", () => resolve({ status: 500, body: "" }));
    req.write(rawBody || "{}");
    req.end();
  });
}
function isTokenExpired(cookieStr) {
  try {
    const rawJwt = cookieStr.replace(/^studymeta_access=/, "").split(";")[0];
    const parts = rawJwt.split(".");
    if (parts.length < 2) return true;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    if (!payload.exp) return true;
    return Math.floor(Date.now() / 1e3) >= payload.exp - 7200;
  } catch {
    return true;
  }
}
setInterval(async () => {
  try {
    console.log("[Heartbeat] Proactively refreshing session token...");
    await fetchFreshAccessCookie();
  } catch (err) {
    console.warn("[Heartbeat] Proactive token refresh error:", err);
  }
}, 6 * 60 * 60 * 1e3);
async function fetchFreshAccessCookie() {
  try {
    const anonId = "anon_" + Date.now();
    const pageData = await new Promise((resolve, reject) => {
      const getReq = https.get(
        `${TARGET_ORIGIN}/key-generate?redirect=%2Fstudy%2Fbatches&type=full&anon_id=${anonId}`,
        {
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            referer: `${TARGET_ORIGIN}/study/batches`,
            cookie: `anon_id=${anonId}`
          }
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on(
            "end",
            () => resolve({
              status: res.statusCode || 200,
              body: Buffer.concat(chunks).toString("utf-8")
            })
          );
        }
      );
      getReq.setTimeout(8e3, () => {
        getReq.destroy();
        reject(new Error("Timeout fetching key-generate page"));
      });
      getReq.on("error", reject);
    });
    const m = pageData.body.match(/\\?"token\\?":\s*\\?"([^"\\]+)\\?"/);
    if (!m || !m[1]) {
      return cachedAccessCookie;
    }
    const token = m[1];
    const verifyData = await new Promise((resolve, reject) => {
      const verifyReq = https.request(
        `${TARGET_ORIGIN}/api/complete-verification`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            referer: `${TARGET_ORIGIN}/verify?token=${encodeURIComponent(token)}`
          }
        },
        (res) => {
          resolve({ status: res.statusCode || 200, headers: res.headers });
        }
      );
      verifyReq.setTimeout(8e3, () => {
        verifyReq.destroy();
        reject(new Error("Timeout completing verification"));
      });
      verifyReq.on("error", reject);
      verifyReq.write(JSON.stringify({ token }));
      verifyReq.end();
    });
    const setCookies = verifyData.headers["set-cookie"] || [];
    const accessCookie = (Array.isArray(setCookies) ? setCookies : [setCookies]).find((c) => c.startsWith("studymeta_access="));
    if (accessCookie) {
      cachedAccessCookie = accessCookie.split(";")[0];
      return cachedAccessCookie;
    }
  } catch (err) {
    console.error("Failed to auto-refresh access cookie:", err);
  }
  return cachedAccessCookie;
}
async function getAccessCookie() {
  if (cachedAccessCookie && !isTokenExpired(cachedAccessCookie)) {
    return cachedAccessCookie;
  }
  if (!refreshPromise) {
    refreshPromise = fetchFreshAccessCookie().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
async function fetchWithAuth(url, referer) {
  let cookie = await getAccessCookie();
  const doRequest = (c) => new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          referer,
          cookie: c
        },
        agent: keepAliveAgent
      },
      (res2) => {
        const chunks = [];
        res2.on("data", (d) => chunks.push(d));
        res2.on(
          "end",
          () => resolve({
            status: res2.statusCode || 200,
            body: Buffer.concat(chunks).toString("utf-8")
          })
        );
      }
    );
    req.setTimeout(8e3, () => {
      req.destroy();
      resolve({ status: 504, body: "" });
    });
    req.on("error", () => resolve({ status: 500, body: "" }));
  });
  let res = await doRequest(cookie);
  const isTurnstileChallenge = res.status === 403 && res.body && res.body.includes("VIDEO_VERIFICATION_REQUIRED");
  if (!isTurnstileChallenge && (res.status === 401 || res.status === 403 || res.status === 307 || (res.body && res.body.includes("Unauthorised")))) {
    console.log(`Auth invalidated on ${url}, refreshing token and retrying...`);
    cachedAccessCookie = "";
    cookie = await getAccessCookie();
    res = await doRequest(cookie);
  }
  return res;
}
async function prewarmEssentialPages() {
  const pages = [
    "/study/batches",
    "/study/nexttoppers",
    "/study/missionjeet",
    "/study/vibrant",
    "/study/batches?_rsc=1",
    "/study/nexttoppers?_rsc=1",
    "/study/missionjeet?_rsc=1"
  ];
  for (const p of pages) {
    try {
      const res = await fetchWithAuth(`${TARGET_ORIGIN}${p}`, `${TARGET_ORIGIN}/study/batches`);
      if (res.status === 200 && res.body) {
        const modified = transformText(res.body);
        const isRsc = p.includes("_rsc=");
        pageCache.set(`${p}:${isRsc ? "1" : "0"}`, {
          body: Buffer.from(modified, "utf-8"),
          headers: {
            "content-type": isRsc ? "text/x-component" : "text/html; charset=utf-8"
          },
          timestamp: Date.now()
        });
      }
    } catch {
    }
  }
}
setTimeout(prewarmEssentialPages, 1e3);
setInterval(prewarmEssentialPages, 10 * 60 * 1e3);
function transformText(content) {
  let text = content;
  text = text.replaceAll("https://www.learnxpw.site", "");
  text = text.replaceAll("http://www.learnxpw.site", "");
  text = text.replaceAll("https:\\/\\/www.learnxpw.site", "");
  text = text.replaceAll("https://learnxpw.site", "");
  text = text.replaceAll("http://learnxpw.site", "");
  text = text.replaceAll("https:\\/\\/learnxpw.site", "");
  text = text.replaceAll(OLD_ICON_URL, ICON_URL);
  text = text.replaceAll("https:\\/\\/i.ibb.co\\/V8CbjrG\\/image.png", ICON_URL.replace(/\//g, "\\/"));
  text = text.replaceAll("V8CbjrG/image.png", "Q3g9fGSt/1791541921524.png");
  text = text.replaceAll("V8CbjrG\\/image.png", "Q3g9fGSt\\/1791541921524.png");
  text = text.replaceAll("https://ibb.co/0R7qc34v", ICON_URL);
  text = text.replaceAll("https:\\/\\/ibb.co\\/0R7qc34v", ICON_URL.replace(/\//g, "\\/"));
  text = text.replaceAll(OLD_TG_URL, TELEGRAM_URL);
  text = text.replaceAll("https:\\/\\/t.me\\/+AgMz8cG-x8VmNGY1", TELEGRAM_URL.replace(/\//g, "\\/"));
  text = text.replaceAll(OLD_TG_URL_ALT, TELEGRAM_URL);
  text = text.replaceAll("https:\\/\\/t.me\\/AgMz8cG-x8VmNGY1", TELEGRAM_URL.replace(/\//g, "\\/"));
  text = text.replaceAll("://t.me/+AgMz8cG-x8VmNGY1", "://t.me/GBFreestudy");
  text = text.replaceAll(":\\/\\/t.me\\/+AgMz8cG-x8VmNGY1", ":\\/\\/t.me\\/GBFreestudy");
  text = text.replaceAll("+AgMz8cG-x8VmNGY1", "GBFreestudy");
  text = text.replaceAll("AgMz8cG-x8VmNGY1", "GBFreestudy");
  text = text.replaceAll("@bookverse_probot", "@sarvottamji");
  text = text.replaceAll('"LearnX_9/58"', '"GBFreestudy"');
  text = text.replaceAll('"Mikkimeoww"', '"sarvottamji"');
  text = text.replaceAll('"webName":"Learnxpw"', `"webName":"${BRAND_NAME}"`);
  text = text.replaceAll('"sidebarTitle":"Learnxpw"', `"sidebarTitle":"${BRAND_NAME}"`);
  text = text.replaceAll("Learnxpw \u2014 a comprehensive online study platform", `${BRAND_NAME} \u2014 a comprehensive online study platform`);
  text = text.replaceAll("<title>Learnxpw</title>", `<title>${BRAND_NAME}</title>`);
  text = text.replaceAll("\xA9 2026 Learnxpw", `\xA9 2026 ${BRAND_NAME}`);
  text = text.replaceAll("\xA9 2025 Learnxpw", `\xA9 2025 ${BRAND_NAME}`);
  text = text.replaceAll("Learnxpw", BRAND_NAME);
  text = text.replaceAll("LEARNXPW", BRAND_NAME);
  text = text.replaceAll("learnxpw", BRAND_NAME);
  text = text.replaceAll(/"shortner_servers":\[[^\]]*\]/g, '"shortner_servers":[]');
  text = text.replaceAll('"isDirectLoginOpen":false', '"isDirectLoginOpen":true');
  if (text.includes("lx-video-turnstile-script") || text.includes("VIDEO_VERIFICATION_REQUIRED")) {
    text = text.replace(
      /(function (\w+)\(\)\{for\(let [^}]+\}async function \w+\(\)\{)\w+\("checking"\);/g,
      "$1$2();return;"
    );
    text = text.replace(/let (\w+)=window\.fetch;return window\.fetch=/g, "return;let $1=window.fetch;return window.fetch=");
  }
  text = text.replace(/(app\/watch\/layout-[a-zA-Z0-9_-]+\.js)(?:\?gbv=\d+)?/g, "$1?gbv=6");
  text = text.replace(/(app\/live\/layout-[a-zA-Z0-9_-]+\.js)(?:\?gbv=\d+)?/g, "$1?gbv=6");
  text = text.replace(/(app\/contact\/page-[a-zA-Z0-9_-]+\.js)(?:\?gbv=\d+)?/g, "$1?gbv=6");
  const EXISTING_HEAD_SCRIPT = `document.querySelectorAll('body link[rel="icon"], body link[rel="apple-touch-icon"]').forEach(el => document.head.appendChild(el))`;
  const ENHANCED_HEAD_SCRIPT = `${EXISTING_HEAD_SCRIPT};
(function() {
  if (typeof window === 'undefined') return;
  try {
    if ('adoptedStyleSheets' in document) {
      var gbSheet = new CSSStyleSheet();
      gbSheet.replaceSync('main.min-h-\\\\[65vh\\\\].items-center.justify-center>section.max-w-sm.rounded-2xl,main.fixed.z-\\\\[100\\\\].inset-0,aside nav a[href="/study/pi"],aside nav a[href="/study/nexttoppers"],aside nav a[href="/study/missionjeet"],aside nav a[href="/study/vibrant"],aside nav a[href="/study/sway"],aside nav a[data-pw-books="1"]{display:none!important}');
      document.adoptedStyleSheets = [].slice.call(document.adoptedStyleSheets).concat([gbSheet]);
    }
  } catch(e) {}
  try {
    var curFetch = window.fetch;
    var ownFd = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (typeof curFetch === 'function' && (!ownFd || (!ownFd.writable && ownFd.configurable))) {
      Object.defineProperty(window, 'fetch', { configurable: true, enumerable: true, writable: true, value: curFetch });
    }
  } catch(e) {}
  var pwIconUrl = 'https://i.ibb.co/Q3g9fGSt/1791541921524.png';

  function hideMenuItems() {
    try {
      var links = document.querySelectorAll('aside nav a, nav a');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var h = (a.getAttribute('href') || '').toLowerCase();
        var t = (a.textContent || '').trim().toLowerCase();
        if (a.getAttribute('data-pw-books') === '1' || t === 'pw books') {
          a.remove();
          continue;
        }
        if (
          h === '/study/pi' || h.indexOf('/study/pi/') === 0 ||
          h === '/study/nexttoppers' || h.indexOf('/study/nexttoppers/') === 0 ||
          h === '/study/missionjeet' || h.indexOf('/study/missionjeet/') === 0 ||
          h === '/study/vibrant' || h.indexOf('/study/vibrant/') === 0 ||
          h === '/study/sway' || h.indexOf('/study/sway/') === 0 ||
          t === 'pi' || t === 'next toppers' || t === 'nexttoppers' ||
          t === 'missionjeet' || t === 'mission jeet' ||
          t === 'vibrant' || t === 'selection way'
        ) {
          a.style.setProperty('display', 'none', 'important');
        }
      }
    } catch(e) {}
  }

  function injectPoweredBy() {
    try {
      var allButtons = document.querySelectorAll('button');
      var loadMoreWrap = null;
      for (var i = 0; i < allButtons.length; i++) {
        var txt = (allButtons[i].textContent || '').trim();
        if (txt === 'Load More' || txt === 'Loading...') {
          loadMoreWrap = allButtons[i].closest('.flex.justify-center') || allButtons[i].parentElement;
          if (loadMoreWrap && loadMoreWrap.parentElement) break;
        }
      }
      var pBox = document.getElementById('gb-powered-by');
      function makePBox() {
        var el = document.createElement('div');
        el.id = 'gb-powered-by';
        el.className = 'w-full text-center py-6 mt-4 mb-8 flex justify-center items-center text-sm text-slate-400 font-medium tracking-wide';
        el.innerHTML = 'Powered by&nbsp;<a href="https://t.me/sarvottamji" target="_blank" rel="noopener noreferrer" class="font-bold underline underline-offset-4 transition-colors" style="color: #ef4444 !important; font-weight: 700; text-decoration: underline; text-underline-offset: 4px;"><span style="color: #ef4444 !important;">GB STUDY</span></a>';
        return el;
      }
      if (loadMoreWrap && loadMoreWrap.parentElement) {
        if (!pBox) pBox = makePBox();
        if (loadMoreWrap.nextElementSibling !== pBox) {
          loadMoreWrap.parentElement.insertBefore(pBox, loadMoreWrap.nextSibling);
        }
        return;
      }
      var grids = document.querySelectorAll('.grid');
      if (grids.length > 0) {
        var parentBox = grids[grids.length - 1].parentElement;
        if (parentBox) {
          if (!pBox) pBox = makePBox();
          if (parentBox.lastElementChild !== pBox) {
            parentBox.appendChild(pBox);
          }
          return;
        }
      }
      if (pBox && pBox.parentNode) {
        pBox.parentNode.removeChild(pBox);
      }
    } catch(e) {}
  }

  function fixMissingBatchBanners() {
    try {
      var imgs = document.querySelectorAll('img');
      imgs.forEach(function(img) {
        var s = img.getAttribute('src') || img.src || '';
        if (!s || s.trim() === '' || s.includes('undefined') || s.includes('null')) {
          img.src = pwIconUrl;
        }
        if (!img.dataset.pwErrorBound) {
          img.dataset.pwErrorBound = '1';
          img.addEventListener('error', function() {
            this.src = pwIconUrl;
          });
        }
      });
    } catch(e) {}
  }

  var isHydrated = false;

  function enableEnhancer() {
    if (isHydrated) return;
    isHydrated = true;
    runAll();
    setInterval(runAll, 500);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('load', function() {
      setTimeout(enableEnhancer, 1200);
    });

    ['pointerdown', 'touchstart', 'click', 'scroll'].forEach(function(evt) {
      window.addEventListener(evt, function() {
        enableEnhancer();
        setTimeout(runAll, 50);
      }, { passive: true });
    });
  }

  function runAll() {
    if (!isHydrated) return;
    hideMenuItems();
    injectPoweredBy();
    fixMissingBatchBanners();
  }
})();`;
  if (text.includes(EXISTING_HEAD_SCRIPT)) {
    text = text.replace(EXISTING_HEAD_SCRIPT, ENHANCED_HEAD_SCRIPT);
  }
  return text;
}
app.get("/logo.png", (_req, res) => {
  const localLogo = path.resolve(process.cwd(), "public", "logo.png");
  if (fs.existsSync(localLogo)) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(localLogo).pipe(res);
  } else {
    res.redirect(ICON_URL);
  }
});
app.get("/cloudflare-pages.zip", (_req, res) => {
  const zipPath = path.resolve(process.cwd(), "public", "cloudflare-pages.zip");
  if (fs.existsSync(zipPath)) {
    const stat = fs.statSync(zipPath);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Disposition", 'attachment; filename="cloudflare-pages.zip"');
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const stream = fs.createReadStream(zipPath);
    stream.on("error", (err) => {
      console.error("Error streaming cloudflare-pages.zip:", err);
      if (!res.headersSent) res.status(500).send("Failed to read zip archive.");
      else res.end();
    });
    stream.pipe(res);
  } else {
    res.status(404).send("Not found. Please run npm run build.");
  }
});
app.get(["/worker.js", "/_worker.js"], (_req, res) => {
  const workerPath = path.resolve(process.cwd(), "worker.js");
  if (fs.existsSync(workerPath)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(workerPath).pipe(res);
  } else {
    res.status(404).send("Worker script not found. Please run npm run build.");
  }
});
app.get("/", (req, res) => {
  if (req.query.home === "1") {
    handleProxy(req, res, "/");
  } else {
    res.redirect(307, "/study/batches");
  }
});
app.get("/key-generate", async (req, res) => {
  const cookie = await getAccessCookie();
  if (cookie) {
    res.setHeader("Set-Cookie", `${cookie}; Path=/; SameSite=Lax; Max-Age=86400`);
  }
  const target = req.query.redirect || "/study/batches";
  res.redirect(307, target);
});
app.get("/verify", async (_req, res) => {
  const cookie = await getAccessCookie();
  if (cookie) {
    res.setHeader("Set-Cookie", `${cookie}; Path=/; SameSite=Lax; Max-Age=86400`);
  }
  res.redirect(307, "/study/batches");
});
app.get("/study/key", (_req, res) => {
  res.redirect(307, "/study/batches");
});
app.get("/api/Schedule", async (req, res) => {
  const batchId = String(req.query.BatchId || req.query.batchId || req.query.batch_id || "");
  const subjectId = String(req.query.SubjectId || req.query.subjectId || req.query.subject_id || "");
  const contentId = String(req.query.ContentId || req.query.contentId || req.query.ChildId || req.query.childId || req.query.videoId || req.query.video_id || "");
  const accessCookie = await getAccessCookie();
  const watchReferer = `${TARGET_ORIGIN}/watch?batchId=${batchId}&SubjectId=${subjectId}&ContentId=${contentId}`;
  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(contentId)}`;
    const upstreamRes = await new Promise((resolve) => {
      https.get(
        upstreamUrl,
        {
          headers: {
            "user-agent": req.headers["user-agent"] || CHROME_UA,
            referer: watchReferer,
            cookie: accessCookie
          }
        },
        (proxyRes) => {
          const chunks = [];
          proxyRes.on("data", (c) => chunks.push(c));
          proxyRes.on("end", () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
              resolve({ status: proxyRes.statusCode || 200, data: parsed });
            } catch {
              resolve({ status: proxyRes.statusCode || 500, data: null });
            }
          });
        }
      ).on("error", () => resolve({ status: 500, data: null }));
    });
    const lxData = upstreamRes.data?.data;
    const lxFirst = Array.isArray(lxData) ? lxData[0] : lxData;
    if (upstreamRes.status === 200 && upstreamRes.data?.success && lxFirst?.urlType) {
      const items = Array.isArray(lxData) ? lxData : [lxData];
      normalizeTopicItems(items, batchId, subjectId);
      if (lxFirst.urlType === "vimeo" && batchId && subjectId && contentId) {
        const dec = await fetchPwmarcoPrimaryStream({
          batchId,
          subjectId,
          contentId,
          videoId: String(lxFirst.videoDetails?._id || lxFirst.videoDetails?.id || ""),
          format: "hls"
        });
        if (dec) {
          lxFirst.urlType = "penpencilvdo";
        }
      }
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(transformText(JSON.stringify(upstreamRes.data)));
    }
  } catch (err) {
    console.warn("Upstream /api/Schedule fetch encountered error, using pwmarco/resilient fallback:", err);
  }

  try {
    if (batchId && subjectId && contentId) {
      const pwRes = await fetchPwmarcoJson(
        `/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(contentId)}`,
        { referer: `${PWMARCO_ORIGIN}/watch?batchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ChildId=${encodeURIComponent(contentId)}` }
      );
      const pwData = pwRes.data?.data;
      const pwFirst = Array.isArray(pwData) ? pwData[0] : pwData;
      if (pwRes.status === 200 && pwRes.data?.success && pwFirst) {
        const items = Array.isArray(pwData) ? pwData : [pwData];
        normalizeTopicItems(items, batchId, subjectId);
        if (!pwFirst.urlType || pwFirst.urlType === "vimeo") {
          const dec = await fetchPwmarcoPrimaryStream({
            batchId,
            subjectId,
            contentId,
            videoId: String(pwFirst.videoDetails?._id || pwFirst.videoDetails?.id || ""),
            format: "hls"
          });
          if (dec) {
            pwFirst.urlType = "penpencilvdo";
          } else if (!pwFirst.urlType) {
            pwFirst.urlType = "penpencilvdo";
          }
        }
        res.setHeader("Content-Type", "application/json");
        return res.status(200).send(transformText(JSON.stringify(pwRes.data)));
      }
    }
  } catch (err) {
    console.warn("Pwmarco /api/Schedule fallback error:", err);
  }

  let urlType = "penpencilvdo";
  let videoUrl = "";
  const topic = "Class Lecture";
  try {
    const vUrl = `${TARGET_ORIGIN}/api/video-url?batch_id=${encodeURIComponent(batchId)}&subject_id=${encodeURIComponent(subjectId)}&video_id=${encodeURIComponent(contentId)}`;
    const vRes = await new Promise((resolve) => {
      https.get(
        vUrl,
        {
          headers: {
            "user-agent": req.headers["user-agent"] || CHROME_UA,
            referer: watchReferer,
            cookie: accessCookie
          }
        },
        (proxyRes) => {
          const chunks = [];
          proxyRes.on("data", (c) => chunks.push(c));
          proxyRes.on("end", () => {
            try {
              resolve({
                status: proxyRes.statusCode || 200,
                data: JSON.parse(Buffer.concat(chunks).toString("utf-8"))
              });
            } catch {
              resolve({ status: proxyRes.statusCode || 500, data: null });
            }
          });
        }
      ).on("error", () => resolve({ status: 500, data: null }));
    });
    if (vRes.status === 200 && vRes.data?.success && vRes.data?.data) {
      urlType = vRes.data.data.urlType || "penpencilvdo";
      videoUrl = vRes.data.data.url || "";
    }
  } catch {
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    success: true,
    data: {
      _id: contentId,
      topic,
      title: topic,
      name: topic,
      urlType,
      url: videoUrl,
      videoDetails: {},
      availableFor: [],
      platformRestricted: false,
      restrictedSchedule: false,
      restrictedTime: 0
    }
  });
});
app.get("/api/auth/serverInfo", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    webName: BRAND_NAME,
    sidebarLogoUrl: ICON_URL,
    sidebarTitle: BRAND_NAME,
    maintenanceMode: false,
    tg_channel: TELEGRAM_URL,
    tg_username: "sarvottamji",
    isDirectLoginOpen: true,
    tg_bot: "@sarvottamji",
    shortner_servers: []
  });
});
app.get("/api/video-security/status", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.status(200).json({
    enabled: false,
    verified: true,
    siteKey: ""
  });
});
app.post("/api/video-security/verify", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    success: true,
    verified: true
  });
});
app.get("/api/AllBatches", async (req, res) => {
  const page = String(req.query.page || "1");
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const cached = allBatchesCache.get(page);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Cache", "HIT");
    return res.status(200).send(cached.rawString);
  }
  const globalStart = (pageNum - 1) * 20;
  const globalEnd = pageNum * 20;
  const pwStart = Math.floor(globalStart / 15) + 1;
  const pwEnd = Math.ceil(globalEnd / 15);
  const pwPages = [];
  for (let p = pwStart; p <= pwEnd; p++) pwPages.push(p);
  try {
    const [lxRes, ...pwResults] = await Promise.all([
      fetchWithAuth(`${TARGET_ORIGIN}/api/AllBatches?page=${encodeURIComponent(pageNum)}`, `${TARGET_ORIGIN}/study/batches`).catch(() => ({ status: 500, body: "" })),
      ...pwPages.map((p) => fetchPwmarcoJson(`/api/AllBatches?page=${p}`, { referer: `${PWMARCO_ORIGIN}/study/batches` }))
    ]);
    let lxParsed = null;
    if (lxRes.status === 200 && lxRes.body) {
      try {
        lxParsed = JSON.parse(lxRes.body);
      } catch {
      }
    }
    const lxBatches = Array.isArray(lxParsed?.batches) ? lxParsed.batches : [];
    for (const b of lxBatches) {
      if (b && b._id) lxExistenceCache.set(String(b._id), true);
      if (!b.previewImage || !b.previewImage.startsWith("http") || b.previewImage.trim() === "") {
        b.previewImage = ICON_URL;
      }
    }
    const seenIds = new Set(lxBatches.map((b) => String(b._id)));
    const pwCandidates = [];
    let pwTotalItems = 0;
    let pwTotalPages = 1;
    for (let idx = 0; idx < pwResults.length; idx++) {
      const pwRes = pwResults[idx];
      const pwPageNum = pwPages[idx];
      if (pwRes?.status === 200 && pwRes.data?.success && Array.isArray(pwRes.data.data)) {
        pwTotalItems = Math.max(pwTotalItems, Number(pwRes.data.totalItems || 0));
        pwTotalPages = Math.max(pwTotalPages, Number(pwRes.data.totalPages || 1));
        for (let i = 0; i < pwRes.data.data.length; i++) {
          const globalIdx = (pwPageNum - 1) * 15 + i;
          if (globalIdx < globalStart || globalIdx >= globalEnd) continue;
          const b = pwRes.data.data[i];
          const id = String(b._id || b.batchId || "");
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            pwCandidates.push(b);
          }
        }
      }
    }
    const missingChecks = await Promise.all(
      pwCandidates.map(async (b) => {
        const id = String(b._id || b.batchId || "");
        const exists = await existsInLearnxpw(id, b.batchName || b.name || "");
        return exists ? null : normalizePwmarcoBatch(b);
      })
    );
    const missingBatches = missingChecks.filter(Boolean);
    const mergedBatches = [...lxBatches, ...missingBatches];
    if (mergedBatches.length > 0 || lxParsed?.success) {
      const lxTotalPages = Number(lxParsed?.totalPages || 1);
      const lxTotal = Number(lxParsed?.total || 0);
      const resultObj = {
        success: true,
        batches: mergedBatches,
        currentPage: pageNum,
        totalPages: Math.max(lxTotalPages, Math.ceil(pwTotalItems / 20), 1),
        pageSize: 20,
        total: Math.max(lxTotal, pwTotalItems, mergedBatches.length)
      };
      const modified = transformText(JSON.stringify(resultObj));
      allBatchesCache.set(page, {
        data: resultObj,
        rawString: modified,
        timestamp: Date.now()
      });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS");
      return res.status(200).send(modified);
    }
  } catch (err) {
    console.warn("Upstream AllBatches fetch error:", err);
  }
  if (cached && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(cached.rawString);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    success: true,
    batches: [],
    totalPages: 1,
    currentPage: 1,
    total: 0
  });
});

app.get("/api/BatchInfo", async (req, res) => {
  const batchId = req.query.BatchId || req.query.batchId || "";
  const type = (req.query.Type || req.query.type || "details").toLowerCase();
  const page = req.query.page || "1";
  if (!batchId || batchId === "undefined" || batchId === "null") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ success: true, data: type === "details" ? {} : [] });
  }
  const cacheKey = `${batchId}:${type}:${page}`;
  const cached = batchInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Cache", "HIT");
    return res.status(200).send(cached.rawString);
  }
  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=${encodeURIComponent(type)}${page ? `&page=${encodeURIComponent(page)}` : ""}`;
    const upstreamRes = await fetchWithAuth(upstreamUrl, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    let lxParsed = null;
    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        lxParsed = JSON.parse(upstreamRes.body);
      } catch {
      }
    }
    const lxHasDetails = type === "details"
      ? Boolean(lxParsed?.success && lxParsed?.data && (Array.isArray(lxParsed.data.subjects) && lxParsed.data.subjects.length > 0))
      : Boolean(lxParsed?.success && Array.isArray(lxParsed?.data) && lxParsed.data.length > 0);
    if (lxHasDetails) {
      const modified = transformText(upstreamRes.body);
      batchInfoCache.set(cacheKey, {
        data: lxParsed,
        rawString: modified,
        timestamp: Date.now()
      });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS");
      return res.status(200).send(modified);
    }
    const pwUrl = `/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=${encodeURIComponent(type)}${type === "announcement" ? `&page=${encodeURIComponent(page)}` : ""}`;
    const pwRes = await fetchPwmarcoJson(pwUrl, { referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}` });
    const pwHasData = pwRes.status === 200 && pwRes.data?.success && pwRes.data?.data && (type === "details" ? Boolean(pwRes.data.data._id || pwRes.data.data.batchName || pwRes.data.data.name) : Array.isArray(pwRes.data.data) && pwRes.data.data.length > 0);
    if (pwHasData) {
      const payload = type === "details"
        ? { ...pwRes.data, data: normalizePwmarcoBatchDetails(pwRes.data.data, batchId) }
        : pwRes.data;
      const modified = transformText(JSON.stringify(payload));
      batchInfoCache.set(cacheKey, {
        data: payload,
        rawString: modified,
        timestamp: Date.now()
      });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS-PW");
      return res.status(200).send(modified);
    }
    if (lxParsed?.success && lxParsed?.data) {
      const modified = transformText(upstreamRes.body);
      batchInfoCache.set(cacheKey, {
        data: lxParsed,
        rawString: modified,
        timestamp: Date.now()
      });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS");
      return res.status(200).send(modified);
    }
  } catch (err) {
    console.warn("Upstream BatchInfo fetch error:", err);
  }
  if (cached && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(cached.rawString);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    success: true,
    data: type === "details" ? { _id: batchId, name: "Batch", subjects: [] } : []
  });
});

app.get("/api/SubjectInfo", async (req, res) => {
  const batchId = req.query.BatchId || req.query.batchId || "";
  const subjectId = req.query.SubjectId || req.query.subjectId || "";
  const page = req.query.page || "1";
  if (!batchId || batchId === "undefined" || !subjectId || subjectId === "undefined") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ success: true, data: [] });
  }
  const cacheKey = `${batchId}:${subjectId}:${page}`;
  const cached = subjectInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Cache", "HIT");
    return res.status(200).send(cached.rawString);
  }
  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${encodeURIComponent(page)}`;
    const upstreamRes = await fetchWithAuth(upstreamUrl, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
          const modified = transformText(upstreamRes.body);
          subjectInfoCache.set(cacheKey, {
            data: parsed,
            rawString: modified,
            timestamp: Date.now()
          });
          res.setHeader("Content-Type", "application/json");
          res.setHeader("X-Cache", "MISS");
          return res.status(200).send(modified);
        }
      } catch {
      }
    }
    const pwRes = await fetchPwmarcoJson(
      `/api/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${encodeURIComponent(page)}`,
      { referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}` }
    );
    if (pwRes.status === 200 && pwRes.data && Array.isArray(pwRes.data.data) && pwRes.data.data.length > 0) {
      const payload = { success: true, ...pwRes.data };
      const modified = transformText(JSON.stringify(payload));
      subjectInfoCache.set(cacheKey, {
        data: payload,
        rawString: modified,
        timestamp: Date.now()
      });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS-PW");
      return res.status(200).send(modified);
    }
  } catch (err) {
    console.warn("Upstream SubjectInfo fetch error:", err);
  }
  if (cached && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(cached.rawString);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ success: true, data: [] });
});

app.get("/api/TopicInfo", async (req, res) => {
  const batchId = req.query.BatchId || req.query.batchId || "";
  const subjectId = req.query.SubjectId || req.query.subjectId || "";
  const topicId = req.query.TopicId || req.query.topicId || "";
  const contentType = req.query.ContentType || req.query.contentType || "videos";
  const page = req.query.page || "1";
  if (!batchId || batchId === "undefined" || !subjectId || subjectId === "undefined" || !topicId || topicId === "undefined") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ success: true, data: [] });
  }
  const cacheKey = `${batchId}:${subjectId}:${topicId}:${contentType}:${page}`;
  const cached = topicInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Cache", "HIT");
    return res.status(200).send(cached.rawString);
  }
  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(topicId)}&ContentType=${encodeURIComponent(contentType)}&page=${encodeURIComponent(page)}`;
    const upstreamRes = await fetchWithAuth(upstreamUrl, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
          normalizeTopicItems(parsed.data, batchId, subjectId);
          const modified = transformText(JSON.stringify(parsed));
          topicInfoCache.set(cacheKey, {
            data: parsed,
            rawString: modified,
            timestamp: Date.now()
          });
          res.setHeader("Content-Type", "application/json");
          res.setHeader("X-Cache", "MISS");
          return res.status(200).send(modified);
        }
      } catch {
      }
    }
    const pwRes = await fetchPwmarcoJson(
      `/api/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(topicId)}&ContentType=${encodeURIComponent(contentType)}&page=${encodeURIComponent(page)}`,
      { referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}` }
    );
    if (pwRes.status === 200 && pwRes.data && Array.isArray(pwRes.data.data) && pwRes.data.data.length > 0) {
      normalizeTopicItems(pwRes.data.data, batchId, subjectId);
      const payload = { success: true, ...pwRes.data };
      const modified = transformText(JSON.stringify(payload));
      topicInfoCache.set(cacheKey, {
        data: payload,
        rawString: modified,
        timestamp: Date.now()
      });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS-PW");
      return res.status(200).send(modified);
    }
  } catch (err) {
    console.warn("Upstream TopicInfo fetch error:", err);
  }
  if (cached && cached.rawString) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(cached.rawString);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ success: true, data: [] });
});

app.get("/api/dpp-list", async (req, res) => {
  const batchId = String(req.query.batchId || "");
  const batchSubjectId = String(req.query.batchSubjectId || "");
  const chapterId = String(req.query.chapterId || "");
  const page = String(req.query.page || "1");
  const limit = String(req.query.limit || "20");
  try {
    const qs = new URLSearchParams({ batchId, batchSubjectId, chapterId, page, limit });
    const lxRes = await fetchWithAuth(`${TARGET_ORIGIN}/api/dpp-list?${qs.toString()}`, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    if (lxRes.status === 200 && lxRes.body) {
      const parsed = JSON.parse(lxRes.body);
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
        res.setHeader("Content-Type", "application/json");
        return res.status(200).send(transformText(lxRes.body));
      }
    }
    if (batchId && batchSubjectId && chapterId) {
      const pwRes = await fetchPwmarcoJson(
        `/api/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(batchSubjectId)}&TopicId=${encodeURIComponent(chapterId)}&ContentType=videos&page=${encodeURIComponent(page)}`,
        { referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}` }
      );
      if (pwRes.status === 200 && Array.isArray(pwRes.data?.data)) {
        const dppItems = [];
        for (const item of pwRes.data.data) {
          const exList = Array.isArray(item.exerciseIds) ? item.exerciseIds : [];
          for (const ex of exList) {
            if (!ex || !ex._id) continue;
            dppItems.push({
              _id: String(ex._id),
              type: "DPP_QUIZ",
              dppQuizDetails: {
                test: {
                  _id: String(ex._id),
                  name: ex.title || item.topic || "DPP Quiz",
                  totalMarks: Number(ex.totalMarks || 0),
                  totalQuestions: Number(ex.totalQuestions || 0),
                  maxDuration: 25,
                  createdAt: item.date || item.startTime || new Date().toISOString(),
                  isSubjective: Boolean(ex.isSubjective),
                  smartDPP: Boolean(ex.smartDPP)
                },
                testStudentMapping: {},
                isPurchased: false,
                tag: "Start",
                isReattempted: false,
                isFree: Boolean(item.isFree),
                scheduleId: String(item._id || ""),
                batchScheduleId: String(item._id || ""),
                subjectId: batchSubjectId,
                exerciseId: String(ex._id),
                contentId: String(ex._id)
              }
            });
          }
        }
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json({ success: true, statusCode: 200, data: dppItems });
      }
    }
  } catch (err) {
    console.warn("Upstream dpp-list fetch error:", err);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ success: true, statusCode: 200, data: [] });
});

app.get("/api/GetPdf", async (req, res) => {
  const batchId = String(req.query.BatchId || req.query.batchId || "");
  const subjectId = String(req.query.SubjectId || req.query.subjectId || "");
  const pdfId = String(req.query.PdfId || req.query.pdfId || "");
  const attachmentId = String(req.query.AttachmentId || req.query.attachmentId || "");
  let homeworkId = String(req.query.HomeworkId || req.query.homeworkId || "");
  try {
    const lxQs = new URLSearchParams({ BatchId: batchId, SubjectId: subjectId, PdfId: pdfId });
    if (attachmentId) lxQs.set("AttachmentId", attachmentId);
    if (homeworkId) lxQs.set("HomeworkId", homeworkId);
    const lxRes = await fetchWithAuth(`${TARGET_ORIGIN}/api/GetPdf?${lxQs.toString()}`, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    if (lxRes.status === 200 && lxRes.body) {
      try {
        const parsed = JSON.parse(lxRes.body);
        const d = parsed?.data?.data || parsed?.data;
        if (d?.baseUrl && d?.key) {
          res.setHeader("Content-Type", "application/json");
          return res.status(200).send(transformText(lxRes.body));
        }
      } catch {
      }
    }
    if (!homeworkId && attachmentId && pdfMetaCache.has(attachmentId)) {
      const meta = pdfMetaCache.get(attachmentId);
      if (meta?.baseUrl && meta?.key) {
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json({
          success: true,
          data: {
            _id: attachmentId,
            baseUrl: meta.baseUrl,
            key: meta.key,
            name: meta.name || "Notes.pdf"
          }
        });
      }
      homeworkId = meta?.homeworkId || "";
    }
    if (!homeworkId && batchId && subjectId && pdfId) {
      const scRes = await fetchPwmarcoJson(
        `/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(pdfId)}`,
        { referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}` }
      );
      if (scRes.status === 200 && scRes.data?.data) {
        const items = Array.isArray(scRes.data.data) ? scRes.data.data : [scRes.data.data];
        normalizeTopicItems(items, batchId, subjectId);
        if (attachmentId && pdfMetaCache.has(attachmentId)) {
          homeworkId = pdfMetaCache.get(attachmentId)?.homeworkId || "";
        }
        if (!homeworkId) {
          const firstHw = items[0]?.homeworkIds?.[0];
          if (firstHw?._id) homeworkId = String(firstHw._id);
        }
      }
    }
    const pwQs = new URLSearchParams({ BatchId: batchId, SubjectId: subjectId, PdfId: pdfId });
    if (homeworkId) pwQs.set("HomeworkId", homeworkId);
    const pwRes = await fetchPwmarcoJson(`/api/GetPdf?${pwQs.toString()}`, {
      referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}`
    });
    if (pwRes.status === 200 && pwRes.data?.data?.baseUrl && pwRes.data?.data?.key) {
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({ success: true, data: pwRes.data.data });
    }
  } catch (err) {
    console.warn("Upstream GetPdf fetch error:", err);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(404).json({ success: false, message: "PDF is not available" });
});

app.post("/api/todays-schedule", async (req, res) => {
  const rawBody = await readRawBody(req);
  let batchId = "";
  try {
    batchId = JSON.parse(rawBody || "{}").batchId || "";
  } catch {
  }
  try {
    const lxRes = await fetchLearnxpwPost("/api/todays-schedule", rawBody, `/study/batches/${batchId}`);
    if (lxRes.status === 200 && lxRes.body) {
      try {
        const parsed = JSON.parse(lxRes.body);
        if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
          normalizeTopicItems(parsed.data, batchId, "");
          res.setHeader("Content-Type", "application/json");
          return res.status(200).send(transformText(JSON.stringify(parsed)));
        }
      } catch {
      }
    }
    const pwRes = await fetchPwmarcoJson("/api/todays-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
      referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}`
    });
    if (pwRes.status === 200 && pwRes.data && Array.isArray(pwRes.data.data)) {
      normalizeTopicItems(pwRes.data.data, batchId, "");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json(pwRes.data);
    }
  } catch (err) {
    console.warn("Upstream todays-schedule error:", err);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ success: true, data: [] });
});

app.post("/api/get-user-details-list", async (req, res) => {
  const rawBody = await readRawBody(req);
  try {
    const lxRes = await fetchLearnxpwPost("/api/get-user-details-list", rawBody, "/study/batches");
    if (lxRes.status === 200 && lxRes.body) {
      const parsed = JSON.parse(lxRes.body);
      if (parsed && (Array.isArray(parsed.data) ? parsed.data.length > 0 : Object.keys(parsed).length > 0)) {
        res.setHeader("Content-Type", "application/json");
        return res.status(200).send(lxRes.body);
      }
    }
    const pwRes = await fetchPwmarcoJson("/api/get-user-details-list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
      referer: `${PWMARCO_ORIGIN}/study/batches`
    });
    if (pwRes.status === 200 && pwRes.data) {
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json(pwRes.data);
    }
  } catch {
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ success: true, data: [] });
});

app.get("/api/stream/*", async (req, res) => {
  const reqPath = req.originalUrl;
  const batchId = String(req.query.batchId || req.query.BatchId || "");
  const isIndexM3u8 = req.path.endsWith("/index.m3u8");
  const accessCookie = await getAccessCookie();
  try {
    const lxRes = await new Promise((resolve) => {
      const gReq = https.get(
        `${TARGET_ORIGIN}${reqPath}`,
        {
          headers: {
            "user-agent": req.headers["user-agent"] || CHROME_UA,
            referer: `${TARGET_ORIGIN}/watch?batchId=${encodeURIComponent(batchId)}`,
            cookie: accessCookie
          },
          agent: keepAliveAgent
        },
        (proxyRes) => {
          const chunks = [];
          proxyRes.on("data", (c) => chunks.push(c));
          proxyRes.on("end", () => {
            resolve({
              status: proxyRes.statusCode || 500,
              headers: proxyRes.headers,
              body: Buffer.concat(chunks)
            });
          });
        }
      );
      gReq.setTimeout(1e4, () => {
        gReq.destroy();
        resolve({ status: 504, headers: {}, body: Buffer.alloc(0) });
      });
      gReq.on("error", () => resolve({ status: 500, headers: {}, body: Buffer.alloc(0) }));
    });
    const lxText = isIndexM3u8 ? lxRes.body.toString("utf-8").trimStart() : "";
    if (lxRes.status === 200 && (!isIndexM3u8 || lxText.startsWith("#EXTM3U"))) {
      res.setHeader("Content-Type", lxRes.headers["content-type"] || (isIndexM3u8 ? "application/vnd.apple.mpegurl" : "application/octet-stream"));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).send(lxRes.body);
    }
  } catch (err) {
    console.warn("Upstream /api/stream error:", err);
  }

  if (isIndexM3u8) {
    const parts = req.path.split("/").filter(Boolean);
    const contentId = decodeURIComponent(parts[2] || "");
    let subjectId = String(req.query.subjectId || req.query.SubjectId || "");
    let subjectSlug = "";
    let resolvedBatchId = batchId;
    let videoId = String(req.query.videoId || "");
    let startTime = String(req.query.startTime || "");
    const meta = videoMetaCache.get(contentId);
    if (meta) {
      if (!subjectId) subjectId = meta.subjectId;
      subjectSlug = meta.subjectSlug || "";
      if (!resolvedBatchId) resolvedBatchId = meta.batchId;
      if (!videoId) videoId = meta.videoId;
      if (!startTime) startTime = meta.startTime || "";
    }
    const isLiveHint = (req.headers.referer || "").includes("/live") || meta?.tag === "Live" || meta?.urlType === "awsVideo";
    if (req.headers.referer) {
      try {
        const refUrl = new URL(req.headers.referer);
        const refSubj = refUrl.searchParams.get("SubjectId") || refUrl.searchParams.get("subjectId") || "";
        if (!subjectId) subjectId = refSubj;
        if (!subjectSlug && refSubj.includes("-")) subjectSlug = refSubj;
        if (!resolvedBatchId) resolvedBatchId = refUrl.searchParams.get("batchId") || refUrl.searchParams.get("BatchId") || "";
        if (!videoId) videoId = refUrl.searchParams.get("videoId") || "";
        if (!startTime) startTime = refUrl.searchParams.get("startTime") || "";
      } catch {
      }
    }
    const tryLiveStream = async () => {
      const liveInfo = await fetchPwmarcoLiveUrl({
        batchId: resolvedBatchId,
        subjectId,
        subjectSlug,
        contentId,
        startTime
      });
      if (!liveInfo) return false;
      try {
        if (liveInfo.isPwmarcoV) {
          const m3u8Res = await fetchPwmarco(liveInfo.fullUrl, {
            referer: `${PWMARCO_ORIGIN}/live?batchId=${encodeURIComponent(resolvedBatchId)}&SubjectId=${encodeURIComponent(subjectId || subjectSlug)}&ChildId=${encodeURIComponent(contentId)}`
          });
          const m3u8Body = await m3u8Res.text();
          if (m3u8Res.status === 200 && m3u8Body.trimStart().startsWith("#EXTM3U")) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.status(200).send(m3u8Body);
            return true;
          }
        } else {
          const m3u8Res = await fetch(liveInfo.fullUrl, { headers: { "user-agent": CHROME_UA } });
          const m3u8Body = await m3u8Res.text();
          if (m3u8Res.status === 200 && m3u8Body.trimStart().startsWith("#EXTM3U")) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.status(200).send(rewriteM3u8Urls(m3u8Body, liveInfo.fullUrl));
            return true;
          }
        }
      } catch (err) {
        console.warn("[pwmarco] Live m3u8 fetch failed:", err?.message || err);
      }
      return false;
    };

    if (resolvedBatchId && (subjectId || subjectSlug) && contentId) {
      if (isLiveHint && await tryLiveStream()) {
        return;
      }
      let dec = await fetchPwmarcoPrimaryStream({
        batchId: resolvedBatchId,
        subjectId,
        subjectSlug,
        contentId,
        videoId,
        format: "hls"
      });
      if (!dec && !videoId) {
        try {
          const scRes = await fetchPwmarcoJson(
            `/api/Schedule?BatchId=${encodeURIComponent(resolvedBatchId)}&SubjectId=${encodeURIComponent(subjectId || subjectSlug)}&ContentId=${encodeURIComponent(contentId)}`,
            { referer: `${PWMARCO_ORIGIN}/watch?batchId=${encodeURIComponent(resolvedBatchId)}&SubjectId=${encodeURIComponent(subjectId || subjectSlug)}&ChildId=${encodeURIComponent(contentId)}` }
          );
          const scItem = Array.isArray(scRes.data?.data) ? scRes.data.data[0] : scRes.data?.data;
          if (scItem) {
            normalizeTopicItems([scItem], resolvedBatchId, subjectId || subjectSlug);
          }
          const scVid = String(scItem?.videoDetails?._id || scItem?.videoDetails?.id || "");
          if (scVid) {
            videoId = scVid;
            dec = await fetchPwmarcoPrimaryStream({
              batchId: resolvedBatchId,
              subjectId: String(scItem?.batchSubjectId || subjectId),
              subjectSlug,
              contentId,
              videoId: scVid,
              format: "hls"
            });
          }
        } catch {
        }
      }
      if (dec?.src && dec.src.startsWith("/api/v/")) {
        try {
          const m3u8Res = await fetchPwmarco(dec.src, {
            referer: `${PWMARCO_ORIGIN}/watch?batchId=${encodeURIComponent(resolvedBatchId)}&SubjectId=${encodeURIComponent(subjectId || subjectSlug)}&ChildId=${encodeURIComponent(contentId)}&Type=penpencilvdo`
          });
          const m3u8Body = await m3u8Res.text();
          if (m3u8Res.status === 200 && m3u8Body.trimStart().startsWith("#EXTM3U")) {
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Access-Control-Allow-Origin", "*");
            return res.status(200).send(m3u8Body);
          }
        } catch (err) {
          console.warn("[pwmarco] Failed to fetch m3u8:", err);
        }
      }
      if (dec?.dash && dec.clearKeys) {
        for (const [k, v] of Object.entries(dec.clearKeys)) {
          pwmarcoClearKeyCache.set(k.replace(/-/g, "").toLowerCase(), { [k.replace(/-/g, "").toLowerCase()]: v });
        }
      }
      if (!isLiveHint && await tryLiveStream()) {
        return;
      }
    }
  }
  return res.status(404).json({ success: false, message: "Stream unavailable" });
});

app.get("/api/v/*", async (req, res) => {
  try {
    const upstreamRes = await fetchPwmarco(req.originalUrl, {
      referer: `${PWMARCO_ORIGIN}/watch`,
      headers: req.headers.range ? { range: req.headers.range } : {}
    });
    const ct = upstreamRes.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const cl = upstreamRes.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    const cr = upstreamRes.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);
    const ar = upstreamRes.headers.get("accept-ranges");
    if (ar) res.setHeader("Accept-Ranges", ar);
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    return res.status(upstreamRes.status).send(buf);
  } catch (err) {
    console.warn("[pwmarco] /api/v proxy error:", err);
    return res.status(502).send("Video segment proxy error");
  }
});

app.get("/api/video-url", async (req, res) => {
  const batchId = String(req.query.batch_id || req.query.batchId || "");
  const subjectIdParam = String(req.query.subject_id || req.query.subjectId || "");
  const videoId = String(req.query.video_id || req.query.videoId || "");
  try {
    const lxRes = await fetchWithAuth(
      `${TARGET_ORIGIN}${req.originalUrl}`,
      `${TARGET_ORIGIN}/watch?batchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectIdParam)}&ContentId=${encodeURIComponent(videoId)}`
    );
    if (lxRes.status === 200 && lxRes.body) {
      const parsed = JSON.parse(lxRes.body);
      if (parsed?.success && parsed?.data?.url) {
        res.setHeader("Content-Type", "application/json");
        return res.status(200).send(lxRes.body);
      }
    }
    if (batchId && (subjectIdParam || videoMetaCache.has(videoId)) && videoId) {
      const meta = videoMetaCache.get(videoId);
      const subjectId = meta?.subjectId || subjectIdParam;
      const subjectSlug = meta?.subjectSlug || (subjectIdParam.includes("-") ? subjectIdParam : "");
      const startTime = String(req.query.startTime || meta?.startTime || "");
      const isLiveHint = (req.headers.referer || "").includes("/live") || meta?.tag === "Live" || meta?.urlType === "awsVideo";

      if (isLiveHint) {
        const liveInfo = await fetchPwmarcoLiveUrl({
          batchId,
          subjectId,
          subjectSlug,
          contentId: videoId,
          startTime
        });
        if (liveInfo) {
          res.setHeader("Content-Type", "application/json");
          return res.status(200).json({
            success: true,
            data: {
              url: liveInfo.baseUrl,
              urlType: "awsVideo",
              signedUrl: liveInfo.signedUrl,
              session: { signatureExpireAt: Date.now() + 36e5 }
            }
          });
        }
      }

      const dec = await fetchPwmarcoPrimaryStream({
        batchId,
        subjectId,
        subjectSlug,
        contentId: videoId,
        videoId: meta?.videoId || ""
      });
      if (dec?.dash) {
        if (dec.clearKeys) {
          for (const [k, v] of Object.entries(dec.clearKeys)) {
            pwmarcoClearKeyCache.set(k.replace(/-/g, "").toLowerCase(), { [k.replace(/-/g, "").toLowerCase()]: v });
          }
        }
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json({
          success: true,
          data: {
            url: `${PWMARCO_ORIGIN}${dec.dash}`,
            urlType: "penpencilvdo",
            signedUrl: ""
          }
        });
      }
      if (dec?.src) {
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json({
          success: true,
          data: {
            url: dec.src,
            urlType: "penpencilvdo",
            signedUrl: ""
          }
        });
      }
      if (!isLiveHint) {
        const liveInfo = await fetchPwmarcoLiveUrl({
          batchId,
          subjectId,
          subjectSlug,
          contentId: videoId,
          startTime
        });
        if (liveInfo) {
          res.setHeader("Content-Type", "application/json");
          return res.status(200).json({
            success: true,
            data: {
              url: liveInfo.baseUrl,
              urlType: "awsVideo",
              signedUrl: liveInfo.signedUrl,
              session: { signatureExpireAt: Date.now() + 36e5 }
            }
          });
        }
      }
    }
  } catch {
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(403).json({ success: false, code: "STREAM_UNAVAILABLE", message: "Live/Video stream unavailable" });
});

app.get("/api/get-otp", async (req, res) => {
  const kid = String(req.query.kid || "").replace(/-/g, "").toLowerCase();
  try {
    const lxRes = await fetchWithAuth(`${TARGET_ORIGIN}${req.originalUrl}`, `${TARGET_ORIGIN}/watch`);
    if (lxRes.status === 200 && lxRes.body) {
      const parsed = JSON.parse(lxRes.body);
      if (parsed?.clearKeys && Object.keys(parsed.clearKeys).length > 0) {
        res.setHeader("Content-Type", "application/json");
        return res.status(200).send(lxRes.body);
      }
    }
  } catch {
  }
  if (kid && pwmarcoClearKeyCache.has(kid)) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ clearKeys: pwmarcoClearKeyCache.get(kid) });
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(404).json({ error: "OTP unavailable" });
});

app.get("/api/play", async (req, res, next) => {
  const targetUrl = String(req.query.url || "");
  if (targetUrl.startsWith(`${PWMARCO_ORIGIN}/api/v/`)) {
    try {
      const pathPart = targetUrl.slice(PWMARCO_ORIGIN.length);
      const upstreamRes = await fetchPwmarco(pathPart, { referer: `${PWMARCO_ORIGIN}/watch` });
      const body = await upstreamRes.text();
      res.setHeader("Content-Type", upstreamRes.headers.get("content-type") || "application/dash+xml");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(upstreamRes.status).send(body);
    } catch {
      return res.status(502).send("Play proxy error");
    }
  }
  return next();
});

app.get("/api/searchBatch", async (req, res) => {
  const name = (req.query.name || "").trim();
  const page = String(req.query.page || "1");
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const accessCookie = await getAccessCookie();
  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/searchBatch?name=${encodeURIComponent(name)}&page=${encodeURIComponent(pageNum)}`;
    const [upstreamRes, pwRes] = await Promise.all([
      new Promise((resolve) => {
        https.get(
          upstreamUrl,
          {
            headers: {
              "user-agent": req.headers["user-agent"] || CHROME_UA,
              referer: `${TARGET_ORIGIN}/study/batches`,
              cookie: accessCookie
            }
          },
          (proxyRes) => {
            const chunks = [];
            proxyRes.on("data", (c) => chunks.push(c));
            proxyRes.on("end", () => {
              resolve({
                status: proxyRes.statusCode || 200,
                body: Buffer.concat(chunks).toString("utf-8")
              });
            });
          }
        ).on("error", () => resolve({ status: 500, body: "" }));
      }),
      fetchPwmarcoJson(`/api/searchBatch?name=${encodeURIComponent(name)}&page=${pageNum}`, {
        referer: `${PWMARCO_ORIGIN}/study/batches`
      })
    ]);

    let lxParsed = null;
    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        lxParsed = JSON.parse(upstreamRes.body);
      } catch {
      }
    }
    const queryKey = name.toLowerCase();
    if (pageNum === 1 || !searchSeenCache.has(queryKey)) {
      searchSeenCache.set(queryKey, { ids: /* @__PURE__ */ new Set(), ts: Date.now() });
      if (searchSeenCache.size > 200) {
        const oldestKey = searchSeenCache.keys().next().value;
        searchSeenCache.delete(oldestKey);
      }
    }
    const seen = searchSeenCache.get(queryKey).ids;
    const merged = [];
    const lxBatches = Array.isArray(lxParsed?.batches) ? lxParsed.batches : [];
    for (const b of lxBatches) {
      const id = String(b._id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (!b.previewImage || !b.previewImage.startsWith("http") || b.previewImage.trim() === "") {
        b.previewImage = ICON_URL;
      }
      merged.push(b);
    }
    const pwBatches = pwRes.status === 200 && pwRes.data?.success && Array.isArray(pwRes.data?.data) ? pwRes.data.data : [];
    for (const b of pwBatches) {
      const id = String(b._id || b.batchId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(normalizePwmarcoBatch(b));
    }
    const lxTotalPages = Number(lxParsed?.totalPages || 1);
    const pwTotalPages = Number(pwRes.data?.totalPages || 1);
    const lxTotal = Number(lxParsed?.total || 0);
    const pwTotal = Number(pwRes.data?.totalItems || 0);
    const result = {
      success: true,
      batches: merged,
      totalPages: Math.max(lxTotalPages, pwTotalPages, 1),
      currentPage: pageNum,
      total: Math.max(lxTotal, pwTotal, merged.length)
    };
    const modified = transformText(JSON.stringify(result));
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(modified);
  } catch (err) {
    console.warn("Upstream searchBatch fetch error:", err);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    success: true,
    batches: [],
    totalPages: 1,
    currentPage: 1,
    total: 0
  });
});
function resolvePath(req) {
  if (req.query.__path && typeof req.query.__path === "string") {
    let p = req.query.__path;
    if (!p.startsWith("/")) p = `/${p}`;
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== "__path" && value !== void 0) {
        if (Array.isArray(value)) {
          value.forEach((v) => searchParams.append(key, String(v)));
        } else {
          searchParams.append(key, String(value));
        }
      }
    }
    const qs = searchParams.toString();
    return qs ? `${p}?${qs}` : p;
  }
  const matched = req.headers["x-matched-path"] || req.headers["x-vercel-matched-path"] || "";
  if (matched && !matched.startsWith("/api/index") && matched !== "/api") {
    const orig = req.originalUrl || req.url || "";
    const qIndex = orig.indexOf("?");
    const queryString = qIndex !== -1 ? orig.slice(qIndex) : "";
    return matched.includes("?") ? matched : `${matched}${queryString}`;
  }
  let target = req.originalUrl || req.url || "/";
  if (target.startsWith("/api/index")) {
    target = target.replace(/^\/api\/index/, "") || "/";
  }
  return target;
}
async function handleProxy(req, res, overridePath, isRetry = false) {
  const targetPath = overridePath || resolvePath(req);
  const targetUrl = new URL(targetPath, TARGET_ORIGIN);
  if (targetPath.startsWith("/_next/static/")) {
    const cachedStatic = staticAssetCache.get(targetPath);
    if (cachedStatic) {
      res.writeHead(200, {
        ...cachedStatic.headers,
        "cache-control": "public, max-age=31536000, immutable",
        "x-cache": "HIT"
      });
      return res.end(cachedStatic.body);
    }
  }
  const isPageOrRsc = req.method === "GET" && (targetPath.startsWith("/study/") || targetPath === "/" || targetPath.includes("_rsc="));
  const pageCacheKey = `${targetPath}:${req.headers["rsc"] || "0"}`;
  if (isPageOrRsc) {
    const cachedPage = pageCache.get(pageCacheKey);
    if (cachedPage && Date.now() - cachedPage.timestamp < CACHE_TTL_MS) {
      res.writeHead(200, {
        ...cachedPage.headers,
        "x-cache": "HIT"
      });
      return res.end(cachedPage.body);
    }
  }
  let refererHeader = `${TARGET_ORIGIN}/`;
  const incomingReferer = req.headers["referer"] || "";
  if (incomingReferer) {
    try {
      const u = new URL(incomingReferer);
      u.protocol = "https:";
      u.host = TARGET_HOST;
      refererHeader = u.toString();
    } catch {
      refererHeader = `${TARGET_ORIGIN}/`;
    }
  }
  if (targetPath.startsWith("/api/video-url") || targetPath.startsWith("/api/get-video-url") || targetPath.startsWith("/api/Schedule") || targetPath.startsWith("/api/play") || targetPath.startsWith("/api/get-otp") || targetPath.startsWith("/api/stream")) {
    const q = targetUrl.searchParams;
    const batchId = q.get("batch_id") || q.get("batchId") || q.get("BatchId") || "";
    const subjectId = q.get("subject_id") || q.get("subjectId") || q.get("SubjectId") || "";
    const videoId = q.get("video_id") || q.get("videoId") || q.get("childId") || q.get("ChildId") || q.get("contentId") || q.get("ContentId") || "";
    if (batchId || subjectId || videoId) {
      refererHeader = `${TARGET_ORIGIN}/watch?batchId=${batchId}&SubjectId=${subjectId}&ContentId=${videoId}`;
    } else {
      refererHeader = `${TARGET_ORIGIN}/watch`;
    }
  }
  const accessCookie = await getAccessCookie();
  const incomingCookie = req.headers["cookie"] || "";
  const mergedCookies = [accessCookie];
  if (incomingCookie) {
    const filteredIncoming = incomingCookie.split(";").map((c) => c.trim()).filter((c) => !c.startsWith("studymeta_access="));
    if (filteredIncoming.length > 0) {
      mergedCookies.push(...filteredIncoming);
    }
  }
  const forwardHeaders = {
    ...req.headers,
    host: TARGET_HOST,
    origin: TARGET_ORIGIN,
    referer: refererHeader,
    cookie: mergedCookies.join("; "),
    "user-agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
  delete forwardHeaders["connection"];
  delete forwardHeaders["keep-alive"];
  delete forwardHeaders["transfer-encoding"];
  delete forwardHeaders["x-matched-path"];
  const isVideoFallbackApi = targetPath.startsWith("/api/video-url") || targetPath.startsWith("/api/pw/pi");
  const isDirectMedia = targetPath.startsWith("/api/play") || targetPath.startsWith("/api/get-otp") || targetPath.startsWith("/api/Schedule") || targetPath.startsWith("/api/stream/") || targetPath.includes(".mpd") || targetPath.includes(".m3u8") || targetPath.includes(".m4s") || targetPath.includes(".mp4") || targetPath.includes(".ts");
  const proxyReq = https.request(
    targetUrl,
    {
      method: req.method,
      headers: forwardHeaders,
      agent: keepAliveAgent
    },
    (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const headers = { ...proxyRes.headers };
      if (((statusCode === 307 || statusCode === 308) && headers["location"] && headers["location"].includes("key-generate") || statusCode === 401 && targetPath.startsWith("/api/stream/")) && !isRetry) {
        console.log(
          `[Proxy] Upstream requested key-generate/reauth for ${targetPath}. Refreshing token and retrying...`
        );
        cachedAccessCookie = "";
        proxyRes.resume();
        fetchFreshAccessCookie().then(() => {
          handleProxy(req, res, overridePath, true);
        });
        return;
      }
      delete headers["x-frame-options"];
      delete headers["content-security-policy"];
      delete headers["content-security-policy-report-only"];
      headers["access-control-allow-origin"] = "*";
      headers["access-control-allow-methods"] = "GET, POST, OPTIONS, HEAD";
      headers["access-control-allow-headers"] = "*";
      if (accessCookie) {
        const clientAccessSet = `${accessCookie}; Path=/; SameSite=Lax; Max-Age=86400`;
        if (headers["set-cookie"]) {
          const sc = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"] : [headers["set-cookie"]];
          headers["set-cookie"] = [clientAccessSet, ...sc];
        } else {
          headers["set-cookie"] = [clientAccessSet];
        }
      }
      if (headers["set-cookie"]) {
        const cookies = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"] : [headers["set-cookie"]];
        headers["set-cookie"] = cookies.map(
          (c) => c.replace(/domain=[^;]+;?/gi, "").replace(/Secure;?/gi, "")
        );
      }
      if (headers["location"]) {
        let loc = headers["location"].replace(
          /https?:\/\/(www\.)?learnxpw\.site/gi,
          ""
        );
        if (loc.includes("key-generate")) {
          try {
            const locUrl = new URL(headers["location"], TARGET_ORIGIN);
            const redirectParam = locUrl.searchParams.get("redirect") || "/study/batches";
            if (redirectParam === targetPath || redirectParam === req.url) {
              loc = "/study/batches";
            } else {
              loc = redirectParam;
            }
          } catch {
            loc = "/study/batches";
          }
        }
        headers["location"] = loc;
      }
      const contentType = (headers["content-type"] || "").toLowerCase();
      const isText = !isDirectMedia && (contentType.includes("text/html") || contentType.includes("application/x-javascript") || contentType.includes("application/javascript") || contentType.includes("text/javascript") || contentType.includes("text/x-component") || contentType.includes("application/json") && !targetPath.startsWith("/api/play"));
      if (!isText) {
        res.writeHead(statusCode, headers);
        proxyRes.pipe(res);
        return;
      }
      const chunks = [];
      proxyRes.on("data", (chunk) => {
        chunks.push(chunk);
      });
      proxyRes.on("end", () => {
        try {
          const rawBuffer = Buffer.concat(chunks);
          let decompressedBuffer = rawBuffer;
          const encoding = (headers["content-encoding"] || "").toLowerCase();
          if (encoding === "gzip") {
            decompressedBuffer = zlib.gunzipSync(rawBuffer);
          } else if (encoding === "br") {
            decompressedBuffer = zlib.brotliDecompressSync(rawBuffer);
          } else if (encoding === "deflate") {
            decompressedBuffer = zlib.inflateSync(rawBuffer);
          }
          const originalText = decompressedBuffer.toString("utf-8");
          let modifiedText = transformText(originalText);
          if (isVideoFallbackApi && statusCode === 403 && modifiedText.includes("VIDEO_VERIFICATION_REQUIRED")) {
            modifiedText = modifiedText.replaceAll("VIDEO_VERIFICATION_REQUIRED", "STREAM_UNAVAILABLE");
          }
          const outputBuffer = Buffer.from(modifiedText, "utf-8");
          delete headers["content-encoding"];
          delete headers["transfer-encoding"];
          headers["content-length"] = String(outputBuffer.length);
          if (contentType.includes("text/html")) {
            headers["cache-control"] = "no-cache, no-store, must-revalidate";
            delete headers["etag"];
          }
          if (targetPath.startsWith("/_next/static/") && statusCode === 200) {
            if (targetPath.includes("/app/watch/layout") || targetPath.includes("/app/live/layout") || targetPath.includes("/app/contact/page")) {
              headers["cache-control"] = "no-cache, no-store, must-revalidate";
            } else {
              headers["cache-control"] = "public, max-age=31536000, immutable";
              staticAssetCache.set(targetPath, {
                body: outputBuffer,
                headers: { ...headers }
              });
            }
          }
          if (isPageOrRsc && statusCode === 200) {
            pageCache.set(pageCacheKey, {
              body: outputBuffer,
              headers: { ...headers },
              timestamp: Date.now()
            });
          }
          res.writeHead(statusCode, headers);
          res.end(outputBuffer);
        } catch (err) {
          console.error("Error modifying text response:", err);
          const rawBuffer = Buffer.concat(chunks);
          delete headers["transfer-encoding"];
          headers["content-length"] = String(rawBuffer.length);
          res.writeHead(statusCode, headers);
          res.end(rawBuffer);
        }
      });
    }
  );
  proxyReq.on("error", (err) => {
    console.error("Proxy request error:", err);
    if (!res.headersSent) {
      res.status(502).send(`Proxy Error: ${err.message}`);
    }
  });
  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}
app.use((req, res) => {
  handleProxy(req, res);
});
var index_default = app;
export {
  index_default as default
};
