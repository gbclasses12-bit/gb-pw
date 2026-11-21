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
let cachedAccessCookie = "studymeta_access=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImZ1bGwiLCJpYXQiOjE3OTM2MjM4ODAsImV4cCI6MTc5MzcxMDI4MH0.RRjEAcW3pPiuWyKF6EDDgK0epLc-gCLCVMna1DFk_nA";
let refreshPromise = null;
const lxExistenceCache = /* @__PURE__ */ new Map();
const searchSeenCache = /* @__PURE__ */ new Map();
const videoMetaCache = /* @__PURE__ */ new Map();
const pdfMetaCache = /* @__PURE__ */ new Map();
const pwmarcoClearKeyCache = /* @__PURE__ */ new Map();
let pwmarcoGuestCookie = "";
let pwmarcoSvsCookie = "";
let pwmarcoAuthPromise = null;

function b64UrlToUint8(str) {
  const bin = base64UrlDecode(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getCookieFromHeader(cookieHeader, name) {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return "";
}

async function getPwmarcoGuestCookie(forceRefresh = false) {
  if (pwmarcoGuestCookie && !forceRefresh) return pwmarcoGuestCookie;
  if (!pwmarcoAuthPromise || forceRefresh) {
    pwmarcoAuthPromise = (async () => {
      try {
        const res = await fetch(`${PWMARCO_ORIGIN}/api/auth/check`, {
          headers: { "user-agent": CHROME_UA, origin: PWMARCO_ORIGIN }
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
      } catch {
      }
      return pwmarcoGuestCookie;
    })().finally(() => {
      pwmarcoAuthPromise = null;
    });
  }
  return pwmarcoAuthPromise;
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
  } catch {
    return null;
  }
}

async function fetchPwmarco(pathWithQuery, options = {}, retry = false) {
  let guest = options.guestCookie || await getPwmarcoGuestCookie(retry);
  let svs = options.svsCookie || pwmarcoSvsCookie;
  const fullCookie = [guest, svs].filter(Boolean).join("; ");
  const res = await fetch(`${PWMARCO_ORIGIN}${pathWithQuery}`, {
    method: options.method || "GET",
    headers: {
      "user-agent": CHROME_UA,
      origin: PWMARCO_ORIGIN,
      referer: options.referer || `${PWMARCO_ORIGIN}/study/batches`,
      ...(fullCookie ? { cookie: fullCookie } : {}),
      ...(options.headers || {})
    },
    body: options.body
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
    return fetchPwmarco(pathWithQuery, { ...options, guestCookie: "" }, true);
  }
  return res;
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
    const res = await fetchEdgeWithAuth(
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

async function fetchEdgePostWithAuth(path, rawBody, refererPath = "/study/batches") {
  let cookie = await getAccessCookie();
  const doReq = async (c) => {
    try {
      const r = await fetch(`${TARGET_ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": CHROME_UA,
          origin: TARGET_ORIGIN,
          referer: `${TARGET_ORIGIN}${refererPath}`,
          cookie: c
        },
        body: rawBody || "{}"
      });
      return { status: r.status, body: await r.text() };
    } catch {
      return { status: 500, body: "" };
    }
  };
  let res = await doReq(cookie);
  if (res.status === 401 || res.status === 403 || (res.body && res.body.includes("Unauthorised"))) {
    cachedAccessCookie = "";
    cookie = await fetchFreshAccessCookie();
    res = await doReq(cookie);
  }
  return res;
}
function base64UrlDecode(str) {
  try {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return atob(b64);
  } catch {
    return "";
  }
}
function isTokenExpired(cookieStr) {
  try {
    const rawJwt = cookieStr.replace(/^studymeta_access=/, "").split(";")[0];
    const parts = rawJwt.split(".");
    if (parts.length < 2) return true;
    const decoded = base64UrlDecode(parts[1]);
    if (!decoded) return true;
    const payload = JSON.parse(decoded);
    if (!payload.exp) return true;
    return Math.floor(Date.now() / 1e3) >= payload.exp - 7200;
  } catch {
    return true;
  }
}
async function fetchFreshAccessCookie() {
  try {
    const anonId = "anon_" + Date.now();
    const keyGenUrl = `${TARGET_ORIGIN}/key-generate?redirect=%2Fstudy%2Fbatches&type=full&anon_id=${anonId}`;
    const res = await fetch(keyGenUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        referer: `${TARGET_ORIGIN}/study/batches`,
        cookie: `anon_id=${anonId}`
      }
    });
    const pageText = await res.text();
    const m = pageText.match(/\\?"token\\?":\s*\\?"([^"\\]+)\\?"/);
    if (!m || !m[1]) {
      return cachedAccessCookie;
    }
    const token = m[1];
    const verifyRes = await fetch(`${TARGET_ORIGIN}/api/complete-verification`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        referer: `${TARGET_ORIGIN}/verify?token=${encodeURIComponent(token)}`
      },
      body: JSON.stringify({ token })
    });
    const rawCookies = typeof verifyRes.headers.getSetCookie === "function"
      ? verifyRes.headers.getSetCookie()
      : (verifyRes.headers.get("set-cookie") ? [verifyRes.headers.get("set-cookie")] : []);
    for (const sc of rawCookies) {
      if (sc && sc.includes("studymeta_access=")) {
        const match = sc.match(/studymeta_access=[^;,\s]+/);
        if (match) {
          cachedAccessCookie = match[0];
          return cachedAccessCookie;
        }
      }
    }
  } catch (err) {
    console.error("[Cloudflare Edge] Failed to auto-refresh access cookie:", err);
  }
  return cachedAccessCookie;
}
async function fetchEdgeWithAuth(url, referer) {
  let cookie = await getAccessCookie();
  const doReq = async (c) => {
    try {
      const r = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          referer,
          cookie: c
        }
      });
      const body = await r.text();
      return { status: r.status, body };
    } catch {
      return { status: 500, body: "" };
    }
  };
  let res = await doReq(cookie);
  const isTurnstileChallenge = res.status === 403 && res.body && res.body.includes("VIDEO_VERIFICATION_REQUIRED");
  if (!isTurnstileChallenge && (res.status === 401 || res.status === 403 || res.status === 307 || (res.body && res.body.includes("Unauthorised")))) {
    cachedAccessCookie = "";
    cookie = await getAccessCookie();
    res = await doReq(cookie);
  }
  return res;
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
function transformText(content) {
  let text = content;
  text = text.replaceAll("https://www.learnxpw.site", "");
  text = text.replaceAll("http://www.learnxpw.site", "");
  text = text.replaceAll("https:\\/\\/www.learnxpw.site", "");
  text = text.replaceAll("https://learnxpw.site", "");
  text = text.replaceAll("http://learnxpw.site", "");
  text = text.replaceAll("https:\\/\\/learnxpw.site", "");
  text = text.replaceAll(OLD_ICON_URL, ICON_URL);
  text = text.replaceAll(
    "https:\\/\\/i.ibb.co\\/V8CbjrG\\/image.png",
    ICON_URL.replace(/\//g, "\\/")
  );
  text = text.replaceAll("V8CbjrG/image.png", "Q3g9fGSt/1791541921524.png");
  text = text.replaceAll("V8CbjrG\\/image.png", "Q3g9fGSt\\/1791541921524.png");
  text = text.replaceAll("https://ibb.co/0R7qc34v", ICON_URL);
  text = text.replaceAll(
    "https:\\/\\/ibb.co\\/0R7qc34v",
    ICON_URL.replace(/\//g, "\\/")
  );
  text = text.replaceAll(OLD_TG_URL, TELEGRAM_URL);
  text = text.replaceAll(
    "https:\\/\\/t.me\\/+AgMz8cG-x8VmNGY1",
    TELEGRAM_URL.replace(/\//g, "\\/")
  );
  text = text.replaceAll(OLD_TG_URL_ALT, TELEGRAM_URL);
  text = text.replaceAll(
    "https:\\/\\/t.me\\/AgMz8cG-x8VmNGY1",
    TELEGRAM_URL.replace(/\//g, "\\/")
  );
  text = text.replaceAll("://t.me/+AgMz8cG-x8VmNGY1", "://t.me/GBFreestudy");
  text = text.replaceAll(":\\/\\/t.me\\/+AgMz8cG-x8VmNGY1", ":\\/\\/t.me\\/GBFreestudy");
  text = text.replaceAll("+AgMz8cG-x8VmNGY1", "GBFreestudy");
  text = text.replaceAll("AgMz8cG-x8VmNGY1", "GBFreestudy");
  text = text.replaceAll("@bookverse_probot", "@sarvottamji");
  text = text.replaceAll('"LearnX_9/58"', '"GBFreestudy"');
  text = text.replaceAll('"Mikkimeoww"', '"sarvottamji"');
  text = text.replaceAll('"webName":"Learnxpw"', `"webName":"${BRAND_NAME}"`);
  text = text.replaceAll(
    '"sidebarTitle":"Learnxpw"',
    `"sidebarTitle":"${BRAND_NAME}"`
  );
  text = text.replaceAll(
    "Learnxpw \u2014 a comprehensive online study platform",
    `${BRAND_NAME} \u2014 a comprehensive online study platform`
  );
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
async function handleEdgeRequest(req, _env, _ctx) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }
  if (pathname === "/") {
    if (url.searchParams.get("home") !== "1") {
      return Response.redirect(`${url.origin}/study/batches`, 307);
    }
  }
  if (pathname === "/key-generate") {
    const accessCookie2 = await getAccessCookie();
    const target = url.searchParams.get("redirect") || "/study/batches";
    const headers = new Headers();
    if (accessCookie2) {
      headers.set("Set-Cookie", `${accessCookie2}; Path=/; SameSite=Lax; Max-Age=86400`);
    }
    headers.set("Location", target.startsWith("http") ? target : `${url.origin}${target}`);
    return new Response(null, { status: 307, headers });
  }
  if (pathname === "/verify") {
    const accessCookie2 = await getAccessCookie();
    const headers = new Headers();
    if (accessCookie2) {
      headers.set("Set-Cookie", `${accessCookie2}; Path=/; SameSite=Lax; Max-Age=86400`);
    }
    headers.set("Location", `${url.origin}/study/batches`);
    return new Response(null, { status: 307, headers });
  }
  if (pathname === "/study/key") {
    return Response.redirect(`${url.origin}/study/batches`, 307);
  }
  if (pathname === "/logo.png") {
    return Response.redirect(ICON_URL, 307);
  }
  if (pathname === "/api/auth/serverInfo") {
    return new Response(
      JSON.stringify({
        webName: BRAND_NAME,
        sidebarLogoUrl: ICON_URL,
        sidebarTitle: BRAND_NAME,
        maintenanceMode: false,
        tg_channel: TELEGRAM_URL,
        tg_username: "sarvottamji",
        isDirectLoginOpen: true,
        tg_bot: "@sarvottamji",
        shortner_servers: []
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
  if (pathname === "/api/video-security/status") {
    return new Response(
      JSON.stringify({
        enabled: false,
        verified: true,
        siteKey: ""
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
  if (pathname === "/api/video-security/verify") {
    return new Response(
      JSON.stringify({
        success: true,
        verified: true
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
  if (pathname === "/api/AllBatches") {
    const page = url.searchParams.get("page") || "1";
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const globalStart = (pageNum - 1) * 20;
    const globalEnd = pageNum * 20;
    const pwStart = Math.floor(globalStart / 15) + 1;
    const pwEnd = Math.ceil(globalEnd / 15);
    const pwPages = [];
    for (let p = pwStart; p <= pwEnd; p++) pwPages.push(p);
    await getAccessCookie();
    try {
      const [lxRes, ...pwResults] = await Promise.all([
        fetchEdgeWithAuth(`${TARGET_ORIGIN}/api/AllBatches?page=${encodeURIComponent(pageNum)}`, `${TARGET_ORIGIN}/study/batches`).catch(() => ({ status: 500, body: "" })),
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
      for (let idx = 0; idx < pwResults.length; idx++) {
        const pwRes = pwResults[idx];
        const pwPageNum = pwPages[idx];
        if (pwRes?.status === 200 && pwRes.data?.success && Array.isArray(pwRes.data.data)) {
          pwTotalItems = Math.max(pwTotalItems, Number(pwRes.data.totalItems || 0));
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
        return new Response(transformText(JSON.stringify(resultObj)), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    } catch {
    }
    return new Response(JSON.stringify({ success: true, batches: [], totalPages: 1, currentPage: 1, total: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/BatchInfo") {
    const batchId = url.searchParams.get("BatchId") || url.searchParams.get("batchId") || "";
    const type = (url.searchParams.get("Type") || url.searchParams.get("type") || "details").toLowerCase();
    const page = url.searchParams.get("page") || "1";
    if (!batchId || batchId === "undefined" || batchId === "null") {
      return new Response(JSON.stringify({ success: true, data: type === "details" ? {} : [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const upstreamUrl = `${TARGET_ORIGIN}/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=${encodeURIComponent(type)}${page ? `&page=${encodeURIComponent(page)}` : ""}`;
    const upstreamRes = await fetchEdgeWithAuth(upstreamUrl, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    let lxParsed = null;
    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        lxParsed = JSON.parse(upstreamRes.body);
      } catch {
      }
    }
    const lxHasDetails = type === "details"
      ? Boolean(lxParsed?.success && lxParsed?.data && Array.isArray(lxParsed.data.subjects) && lxParsed.data.subjects.length > 0)
      : Boolean(lxParsed?.success && Array.isArray(lxParsed?.data) && lxParsed.data.length > 0);
    if (lxHasDetails) {
      return new Response(transformText(upstreamRes.body), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const pwUrl = `/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=${encodeURIComponent(type)}${type === "announcement" ? `&page=${encodeURIComponent(page)}` : ""}`;
    const pwRes = await fetchPwmarcoJson(pwUrl, { referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}` });
    const pwHasData = pwRes.status === 200 && pwRes.data?.success && pwRes.data?.data && (type === "details" ? Boolean(pwRes.data.data._id || pwRes.data.data.batchName || pwRes.data.data.name) : Array.isArray(pwRes.data.data) && pwRes.data.data.length > 0);
    if (pwHasData) {
      const payload = type === "details"
        ? { ...pwRes.data, data: normalizePwmarcoBatchDetails(pwRes.data.data, batchId) }
        : pwRes.data;
      return new Response(transformText(JSON.stringify(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    if (lxParsed?.success && lxParsed?.data) {
      return new Response(transformText(upstreamRes.body), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    return new Response(JSON.stringify({ success: true, data: type === "details" ? { _id: batchId, name: "Batch", subjects: [] } : [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/SubjectInfo") {
    const batchId = url.searchParams.get("BatchId") || url.searchParams.get("batchId") || "";
    const subjectId = url.searchParams.get("SubjectId") || url.searchParams.get("subjectId") || "";
    const page = url.searchParams.get("page") || "1";
    if (!batchId || batchId === "undefined" || !subjectId || subjectId === "undefined") {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const upstreamUrl = `${TARGET_ORIGIN}/api/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${encodeURIComponent(page)}`;
    const upstreamRes = await fetchEdgeWithAuth(upstreamUrl, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
          return new Response(transformText(upstreamRes.body), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      } catch {
      }
    }
    const pwRes = await fetchPwmarcoJson(
      `/api/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${encodeURIComponent(page)}`,
      { referer: `${PWMARCO_ORIGIN}/study/batches/${encodeURIComponent(batchId)}` }
    );
    if (pwRes.status === 200 && pwRes.data && Array.isArray(pwRes.data.data) && pwRes.data.data.length > 0) {
      return new Response(transformText(JSON.stringify({ success: true, ...pwRes.data })), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/TopicInfo") {
    const batchId = url.searchParams.get("BatchId") || url.searchParams.get("batchId") || "";
    const subjectId = url.searchParams.get("SubjectId") || url.searchParams.get("subjectId") || "";
    const topicId = url.searchParams.get("TopicId") || url.searchParams.get("topicId") || "";
    const contentType = url.searchParams.get("ContentType") || url.searchParams.get("contentType") || "videos";
    const page = url.searchParams.get("page") || "1";
    if (!batchId || batchId === "undefined" || !subjectId || subjectId === "undefined" || !topicId || topicId === "undefined") {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const upstreamUrl = `${TARGET_ORIGIN}/api/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(topicId)}&ContentType=${encodeURIComponent(contentType)}&page=${encodeURIComponent(page)}`;
    const upstreamRes = await fetchEdgeWithAuth(upstreamUrl, `${TARGET_ORIGIN}/study/batches/${batchId}`);
    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
          normalizeTopicItems(parsed.data, batchId, subjectId);
          return new Response(transformText(JSON.stringify(parsed)), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
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
      return new Response(transformText(JSON.stringify({ success: true, ...pwRes.data })), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/dpp-list") {
    const batchId = url.searchParams.get("batchId") || "";
    const batchSubjectId = url.searchParams.get("batchSubjectId") || "";
    const chapterId = url.searchParams.get("chapterId") || "";
    const page = url.searchParams.get("page") || "1";
    const limit = url.searchParams.get("limit") || "20";
    try {
      const qs = new URLSearchParams({ batchId, batchSubjectId, chapterId, page, limit });
      const lxRes = await fetchEdgeWithAuth(`${TARGET_ORIGIN}/api/dpp-list?${qs.toString()}`, `${TARGET_ORIGIN}/study/batches/${batchId}`);
      if (lxRes.status === 200 && lxRes.body) {
        const parsed = JSON.parse(lxRes.body);
        if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
          return new Response(transformText(lxRes.body), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
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
          return new Response(JSON.stringify({ success: true, statusCode: 200, data: dppItems }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
    } catch {
    }
    return new Response(JSON.stringify({ success: true, statusCode: 200, data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/GetPdf") {
    const batchId = url.searchParams.get("BatchId") || url.searchParams.get("batchId") || "";
    const subjectId = url.searchParams.get("SubjectId") || url.searchParams.get("subjectId") || "";
    const pdfId = url.searchParams.get("PdfId") || url.searchParams.get("pdfId") || "";
    const attachmentId = url.searchParams.get("AttachmentId") || url.searchParams.get("attachmentId") || "";
    let homeworkId = url.searchParams.get("HomeworkId") || url.searchParams.get("homeworkId") || "";
    try {
      const lxQs = new URLSearchParams({ BatchId: batchId, SubjectId: subjectId, PdfId: pdfId });
      if (attachmentId) lxQs.set("AttachmentId", attachmentId);
      if (homeworkId) lxQs.set("HomeworkId", homeworkId);
      const lxRes = await fetchEdgeWithAuth(`${TARGET_ORIGIN}/api/GetPdf?${lxQs.toString()}`, `${TARGET_ORIGIN}/study/batches/${batchId}`);
      if (lxRes.status === 200 && lxRes.body) {
        try {
          const parsed = JSON.parse(lxRes.body);
          const d = parsed?.data?.data || parsed?.data;
          if (d?.baseUrl && d?.key) {
            return new Response(transformText(lxRes.body), {
              status: 200,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
          }
        } catch {
        }
      }
      if (!homeworkId && attachmentId && pdfMetaCache.has(attachmentId)) {
        const meta = pdfMetaCache.get(attachmentId);
        if (meta?.baseUrl && meta?.key) {
          return new Response(JSON.stringify({
            success: true,
            data: { _id: attachmentId, baseUrl: meta.baseUrl, key: meta.key, name: meta.name || "Notes.pdf" }
          }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
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
        return new Response(JSON.stringify({ success: true, data: pwRes.data.data }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    } catch {
    }
    return new Response(JSON.stringify({ success: false, message: "PDF is not available" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/todays-schedule" && req.method === "POST") {
    const rawBody = await req.text().catch(() => "{}");
    let batchId = "";
    try {
      batchId = JSON.parse(rawBody || "{}").batchId || "";
    } catch {
    }
    try {
      const lxRes = await fetchEdgePostWithAuth("/api/todays-schedule", rawBody, `/study/batches/${batchId}`);
      if (lxRes.status === 200 && lxRes.body) {
        try {
          const parsed = JSON.parse(lxRes.body);
          if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
            normalizeTopicItems(parsed.data, batchId, "");
            return new Response(transformText(JSON.stringify(parsed)), {
              status: 200,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
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
        return new Response(JSON.stringify(pwRes.data), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    } catch {
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/get-user-details-list" && req.method === "POST") {
    const rawBody = await req.text().catch(() => "{}");
    try {
      const lxRes = await fetchEdgePostWithAuth("/api/get-user-details-list", rawBody, "/study/batches");
      if (lxRes.status === 200 && lxRes.body) {
        const parsed = JSON.parse(lxRes.body);
        if (parsed && (Array.isArray(parsed.data) ? parsed.data.length > 0 : Object.keys(parsed).length > 0)) {
          return new Response(lxRes.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
      const pwRes = await fetchPwmarcoJson("/api/get-user-details-list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rawBody,
        referer: `${PWMARCO_ORIGIN}/study/batches`
      });
      if (pwRes.status === 200 && pwRes.data) {
        return new Response(JSON.stringify(pwRes.data), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    } catch {
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname.startsWith("/api/stream/")) {
    const batchId = url.searchParams.get("batchId") || url.searchParams.get("BatchId") || "";
    const isIndexM3u8 = pathname.endsWith("/index.m3u8");
    const accessCookie2 = await getAccessCookie();
    try {
      const lxRes = await fetch(`${TARGET_ORIGIN}${pathname}${url.search}`, {
        headers: {
          "user-agent": req.headers.get("user-agent") || CHROME_UA,
          referer: `${TARGET_ORIGIN}/watch?batchId=${encodeURIComponent(batchId)}`,
          cookie: accessCookie2
        }
      });
      const buf = await lxRes.arrayBuffer();
      const lxText = isIndexM3u8 ? new TextDecoder().decode(buf).trimStart() : "";
      if (lxRes.status === 200 && (!isIndexM3u8 || lxText.startsWith("#EXTM3U"))) {
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": lxRes.headers.get("content-type") || (isIndexM3u8 ? "application/vnd.apple.mpegurl" : "application/octet-stream"),
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch {
    }
    if (isIndexM3u8) {
      const parts = pathname.split("/").filter(Boolean);
      const contentId = decodeURIComponent(parts[2] || "");
      let subjectId = url.searchParams.get("subjectId") || url.searchParams.get("SubjectId") || "";
      let subjectSlug = "";
      let resolvedBatchId = batchId;
      let videoId = url.searchParams.get("videoId") || "";
      let startTime = url.searchParams.get("startTime") || "";
      const meta = videoMetaCache.get(contentId);
      if (meta) {
        if (!subjectId) subjectId = meta.subjectId;
        subjectSlug = meta.subjectSlug || "";
        if (!resolvedBatchId) resolvedBatchId = meta.batchId;
        if (!videoId) videoId = meta.videoId;
        if (!startTime) startTime = meta.startTime || "";
      }
      const incRef = req.headers.get("referer");
      const isLiveHint = (incRef || "").includes("/live") || meta?.tag === "Live" || meta?.urlType === "awsVideo";
      if (incRef) {
        try {
          const refUrl = new URL(incRef);
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
        if (!liveInfo) return null;
        try {
          if (liveInfo.isPwmarcoV) {
            const m3u8Res = await fetchPwmarco(liveInfo.fullUrl, {
              referer: `${PWMARCO_ORIGIN}/live?batchId=${encodeURIComponent(resolvedBatchId)}&SubjectId=${encodeURIComponent(subjectId || subjectSlug)}&ChildId=${encodeURIComponent(contentId)}`
            });
            const m3u8Body = await m3u8Res.text();
            if (m3u8Res.status === 200 && m3u8Body.trimStart().startsWith("#EXTM3U")) {
              const resHeaders = new Headers({
                "Content-Type": "application/vnd.apple.mpegurl",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*"
              });
              if (pwmarcoGuestCookie) {
                resHeaders.append("Set-Cookie", `pw_guest=${encodeURIComponent(pwmarcoGuestCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
              }
              if (pwmarcoSvsCookie) {
                resHeaders.append("Set-Cookie", `pw_svs=${encodeURIComponent(pwmarcoSvsCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
              }
              return new Response(m3u8Body, { status: 200, headers: resHeaders });
            }
          } else {
            const m3u8Res = await fetch(liveInfo.fullUrl, { headers: { "user-agent": CHROME_UA } });
            const m3u8Body = await m3u8Res.text();
            if (m3u8Res.status === 200 && m3u8Body.trimStart().startsWith("#EXTM3U")) {
              return new Response(rewriteM3u8Urls(m3u8Body, liveInfo.fullUrl), {
                status: 200,
                headers: {
                  "Content-Type": "application/vnd.apple.mpegurl",
                  "Cache-Control": "no-store",
                  "Access-Control-Allow-Origin": "*"
                }
              });
            }
          }
        } catch {
        }
        return null;
      };
      if (resolvedBatchId && (subjectId || subjectSlug) && contentId) {
        if (isLiveHint) {
          const liveResp = await tryLiveStream();
          if (liveResp) return liveResp;
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
              const resHeaders = new Headers({
                "Content-Type": "application/vnd.apple.mpegurl",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*"
              });
              if (pwmarcoGuestCookie) {
                resHeaders.append("Set-Cookie", `pw_guest=${encodeURIComponent(pwmarcoGuestCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
              }
              if (pwmarcoSvsCookie) {
                resHeaders.append("Set-Cookie", `pw_svs=${encodeURIComponent(pwmarcoSvsCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
              }
              return new Response(m3u8Body, { status: 200, headers: resHeaders });
            }
          } catch {
          }
        }
        if (dec?.dash && dec.clearKeys) {
          for (const [k, v] of Object.entries(dec.clearKeys)) {
            pwmarcoClearKeyCache.set(k.replace(/-/g, "").toLowerCase(), { [k.replace(/-/g, "").toLowerCase()]: v });
          }
        }
        if (!isLiveHint) {
          const liveResp = await tryLiveStream();
          if (liveResp) return liveResp;
        }
      }
    }
    return new Response(JSON.stringify({ success: false, message: "Stream unavailable" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname.startsWith("/api/v/")) {
    try {
      const incomingCookie = req.headers.get("cookie") || "";
      const guestCookie = decodeURIComponent(getCookieFromHeader(incomingCookie, "pw_guest") || "") || pwmarcoGuestCookie;
      const svsCookie = decodeURIComponent(getCookieFromHeader(incomingCookie, "pw_svs") || "") || pwmarcoSvsCookie;
      const rangeHeader = req.headers.get("range");
      const upstreamRes = await fetchPwmarco(`${pathname}${url.search}`, {
        referer: `${PWMARCO_ORIGIN}/watch`,
        guestCookie,
        svsCookie,
        headers: rangeHeader ? { range: rangeHeader } : {}
      });
      const resHeaders = new Headers({
        "Content-Type": upstreamRes.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      const cl = upstreamRes.headers.get("content-length");
      if (cl) resHeaders.set("Content-Length", cl);
      const cr = upstreamRes.headers.get("content-range");
      if (cr) resHeaders.set("Content-Range", cr);
      const ar = upstreamRes.headers.get("accept-ranges");
      if (ar) resHeaders.set("Accept-Ranges", ar);
      return new Response(upstreamRes.body, { status: upstreamRes.status, headers: resHeaders });
    } catch {
      return new Response("Video segment proxy error", { status: 502 });
    }
  }
  if (pathname === "/api/video-url") {
    const batchId = url.searchParams.get("batch_id") || url.searchParams.get("batchId") || "";
    const subjectIdParam = url.searchParams.get("subject_id") || url.searchParams.get("subjectId") || "";
    const videoId = url.searchParams.get("video_id") || url.searchParams.get("videoId") || "";
    try {
      const lxRes = await fetchEdgeWithAuth(
        `${TARGET_ORIGIN}${pathname}${url.search}`,
        `${TARGET_ORIGIN}/watch?batchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectIdParam)}&ContentId=${encodeURIComponent(videoId)}`
      );
      if (lxRes.status === 200 && lxRes.body) {
        const parsed = JSON.parse(lxRes.body);
        if (parsed?.success && parsed?.data?.url) {
          return new Response(lxRes.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
      if (batchId && (subjectIdParam || videoMetaCache.has(videoId)) && videoId) {
        const meta = videoMetaCache.get(videoId);
        const subjectId = meta?.subjectId || subjectIdParam;
        const subjectSlug = meta?.subjectSlug || (subjectIdParam.includes("-") ? subjectIdParam : "");
        const startTime = url.searchParams.get("startTime") || meta?.startTime || "";
        const isLiveHint = (req.headers.get("referer") || "").includes("/live") || meta?.tag === "Live" || meta?.urlType === "awsVideo";
        const buildLiveJsonResponse = (liveInfo) => {
          const resHeaders = new Headers({ "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          if (liveInfo.isPwmarcoV) {
            if (pwmarcoGuestCookie) {
              resHeaders.append("Set-Cookie", `pw_guest=${encodeURIComponent(pwmarcoGuestCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
            }
            if (pwmarcoSvsCookie) {
              resHeaders.append("Set-Cookie", `pw_svs=${encodeURIComponent(pwmarcoSvsCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
            }
          }
          return new Response(JSON.stringify({
            success: true,
            data: {
              url: liveInfo.baseUrl,
              urlType: "awsVideo",
              signedUrl: liveInfo.signedUrl,
              session: { signatureExpireAt: Date.now() + 36e5 }
            }
          }), { status: 200, headers: resHeaders });
        };
        if (isLiveHint) {
          const liveInfo = await fetchPwmarcoLiveUrl({
            batchId,
            subjectId,
            subjectSlug,
            contentId: videoId,
            startTime
          });
          if (liveInfo) return buildLiveJsonResponse(liveInfo);
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
          const resHeaders = new Headers({ "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          if (pwmarcoGuestCookie) {
            resHeaders.append("Set-Cookie", `pw_guest=${encodeURIComponent(pwmarcoGuestCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
          }
          if (pwmarcoSvsCookie) {
            resHeaders.append("Set-Cookie", `pw_svs=${encodeURIComponent(pwmarcoSvsCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
          }
          return new Response(JSON.stringify({
            success: true,
            data: { url: `${PWMARCO_ORIGIN}${dec.dash}`, urlType: "penpencilvdo", signedUrl: "" }
          }), { status: 200, headers: resHeaders });
        }
        if (dec?.src) {
          const resHeaders = new Headers({ "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          if (pwmarcoGuestCookie) {
            resHeaders.append("Set-Cookie", `pw_guest=${encodeURIComponent(pwmarcoGuestCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
          }
          if (pwmarcoSvsCookie) {
            resHeaders.append("Set-Cookie", `pw_svs=${encodeURIComponent(pwmarcoSvsCookie)}; Path=/api; SameSite=Lax; Max-Age=3600`);
          }
          return new Response(JSON.stringify({
            success: true,
            data: { url: dec.src, urlType: "penpencilvdo", signedUrl: "" }
          }), { status: 200, headers: resHeaders });
        }
        if (!isLiveHint) {
          const liveInfo = await fetchPwmarcoLiveUrl({
            batchId,
            subjectId,
            subjectSlug,
            contentId: videoId,
            startTime
          });
          if (liveInfo) return buildLiveJsonResponse(liveInfo);
        }
      }
    } catch {
    }
    return new Response(JSON.stringify({ success: false, code: "STREAM_UNAVAILABLE", message: "Live/Video stream unavailable" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/get-otp") {
    const kid = (url.searchParams.get("kid") || "").replace(/-/g, "").toLowerCase();
    try {
      const lxRes = await fetchEdgeWithAuth(`${TARGET_ORIGIN}${pathname}${url.search}`, `${TARGET_ORIGIN}/watch`);
      if (lxRes.status === 200 && lxRes.body) {
        const parsed = JSON.parse(lxRes.body);
        if (parsed?.clearKeys && Object.keys(parsed.clearKeys).length > 0) {
          return new Response(lxRes.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
    } catch {
    }
    if (kid && pwmarcoClearKeyCache.has(kid)) {
      return new Response(JSON.stringify({ clearKeys: pwmarcoClearKeyCache.get(kid) }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    return new Response(JSON.stringify({ error: "OTP unavailable" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (pathname === "/api/play") {
    const playTarget = url.searchParams.get("url") || "";
    if (playTarget.startsWith(`${PWMARCO_ORIGIN}/api/v/`)) {
      try {
        const incomingCookie = req.headers.get("cookie") || "";
        const guestCookie = decodeURIComponent(getCookieFromHeader(incomingCookie, "pw_guest") || "") || pwmarcoGuestCookie;
        const svsCookie = decodeURIComponent(getCookieFromHeader(incomingCookie, "pw_svs") || "") || pwmarcoSvsCookie;
        const pathPart = playTarget.slice(PWMARCO_ORIGIN.length);
        const upstreamRes = await fetchPwmarco(pathPart, {
          referer: `${PWMARCO_ORIGIN}/watch`,
          guestCookie,
          svsCookie
        });
        const body = await upstreamRes.text();
        return new Response(body, {
          status: upstreamRes.status,
          headers: {
            "Content-Type": upstreamRes.headers.get("content-type") || "application/dash+xml",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch {
        return new Response("Play proxy error", { status: 502 });
      }
    }
  }
  if (pathname === "/api/Schedule") {
    const batchId = url.searchParams.get("BatchId") || url.searchParams.get("batchId") || url.searchParams.get("batch_id") || "";
    const subjectId = url.searchParams.get("SubjectId") || url.searchParams.get("subjectId") || url.searchParams.get("subject_id") || "";
    const contentId = url.searchParams.get("ContentId") || url.searchParams.get("contentId") || url.searchParams.get("ChildId") || url.searchParams.get("childId") || url.searchParams.get("videoId") || url.searchParams.get("video_id") || "";
    const accessCookie2 = await getAccessCookie();
    const watchReferer = `${TARGET_ORIGIN}/watch?batchId=${batchId}&SubjectId=${subjectId}&ContentId=${contentId}`;
    try {
      const scheduleRes = await fetch(
        `${TARGET_ORIGIN}/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(contentId)}`,
        {
          headers: {
            "user-agent": req.headers.get("user-agent") || CHROME_UA,
            referer: watchReferer,
            cookie: accessCookie2
          }
        }
      );
      if (scheduleRes.status === 200) {
        const data = await scheduleRes.json().catch(() => null);
        const lxFirst = Array.isArray(data?.data) ? data.data[0] : data?.data;
        if (data?.success && lxFirst?.urlType) {
          const items = Array.isArray(data.data) ? data.data : [data.data];
          normalizeTopicItems(items, batchId, subjectId);
          if (lxFirst.urlType === "vimeo" && batchId && subjectId && contentId) {
            const dec = await fetchPwmarcoPrimaryStream({
              batchId,
              subjectId,
              contentId,
              videoId: String(lxFirst.videoDetails?._id || lxFirst.videoDetails?.id || ""),
              format: "hls"
            });
            if (dec) lxFirst.urlType = "penpencilvdo";
          }
          return new Response(transformText(JSON.stringify(data)), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
    } catch {
    }
    try {
      if (batchId && subjectId && contentId) {
        const pwRes = await fetchPwmarcoJson(
          `/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(contentId)}`,
          { referer: `${PWMARCO_ORIGIN}/watch?batchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ChildId=${encodeURIComponent(contentId)}` }
        );
        const pwFirst = Array.isArray(pwRes.data?.data) ? pwRes.data.data[0] : pwRes.data?.data;
        if (pwRes.status === 200 && pwRes.data?.success && pwFirst) {
          const items = Array.isArray(pwRes.data.data) ? pwRes.data.data : [pwRes.data.data];
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
          return new Response(transformText(JSON.stringify(pwRes.data)), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
    } catch {
    }
    let urlType = "penpencilvdo";
    let videoUrl = "";
    try {
      const vRes = await fetch(
        `${TARGET_ORIGIN}/api/video-url?batch_id=${encodeURIComponent(batchId)}&subject_id=${encodeURIComponent(subjectId)}&video_id=${encodeURIComponent(contentId)}`,
        {
          headers: {
            "user-agent": req.headers.get("user-agent") || CHROME_UA,
            referer: watchReferer,
            cookie: accessCookie2
          }
        }
      );
      if (vRes.status === 200) {
        const vData = await vRes.json().catch(() => null);
        if (vData?.success && vData?.data) {
          urlType = vData.data.urlType || "penpencilvdo";
          videoUrl = vData.data.url || "";
        }
      }
    } catch {
    }
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          _id: contentId,
          topic: "Class Lecture",
          title: "Class Lecture",
          name: "Class Lecture",
          urlType,
          url: videoUrl,
          videoDetails: {},
          availableFor: [],
          platformRestricted: false,
          restrictedSchedule: false,
          restrictedTime: 0
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
  if (pathname === "/api/searchBatch") {
    const name = (url.searchParams.get("name") || "").trim();
    const page = url.searchParams.get("page") || "1";
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    try {
      const [upstreamRes, pwRes] = await Promise.all([
        fetchEdgeWithAuth(`${TARGET_ORIGIN}/api/searchBatch?name=${encodeURIComponent(name)}&page=${encodeURIComponent(pageNum)}`, `${TARGET_ORIGIN}/study/batches`).catch(() => ({ status: 500, body: "" })),
        fetchPwmarcoJson(`/api/searchBatch?name=${encodeURIComponent(name)}&page=${pageNum}`, { referer: `${PWMARCO_ORIGIN}/study/batches` })
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
      return new Response(transformText(JSON.stringify({
        success: true,
        batches: merged,
        totalPages: Math.max(lxTotalPages, pwTotalPages, 1),
        currentPage: pageNum,
        total: Math.max(lxTotal, pwTotal, merged.length)
      })), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    } catch {
    }
    return new Response(JSON.stringify({ success: true, batches: [], totalPages: 1, currentPage: 1, total: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  const targetUrl = new URL(pathname + url.search, TARGET_ORIGIN);
  let refererHeader = `${TARGET_ORIGIN}/`;
  const incomingReferer = req.headers.get("referer");
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
  if (pathname.startsWith("/api/video-url") || pathname.startsWith("/api/get-video-url") || pathname.startsWith("/api/Schedule") || pathname.startsWith("/api/play") || pathname.startsWith("/api/get-otp") || pathname.startsWith("/api/stream")) {
    const q = url.searchParams;
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
  const incomingCookie = req.headers.get("cookie") || "";
  const extraIncomingCookies = incomingCookie
    ? incomingCookie.split(";").map((c) => c.trim()).filter((c) => c && !c.startsWith("studymeta_access="))
    : [];
  const mergedCookies = [accessCookie, ...extraIncomingCookies].filter(Boolean);
  const forwardHeaders = new Headers();
  req.headers.forEach((val, key) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey !== "host" &&
      lowerKey !== "connection" &&
      lowerKey !== "transfer-encoding" &&
      lowerKey !== "x-forwarded-proto" &&
      lowerKey !== "x-forwarded-host" &&
      lowerKey !== "x-forwarded-for" &&
      lowerKey !== "x-real-ip" &&
      lowerKey !== "cdn-loop" &&
      lowerKey !== "if-none-match" &&
      lowerKey !== "if-modified-since" &&
      lowerKey !== "accept-encoding" &&
      !lowerKey.startsWith("cf-")
    ) {
      forwardHeaders.set(key, val);
    }
  });
  forwardHeaders.set("host", TARGET_HOST);
  forwardHeaders.set("origin", TARGET_ORIGIN);
  forwardHeaders.set("referer", refererHeader);
  forwardHeaders.set("cookie", mergedCookies.join("; "));
  const isVideoFallbackApi = pathname.startsWith("/api/video-url") || pathname.startsWith("/api/pw/pi");
  const isDirectMedia = pathname.startsWith("/api/play") || pathname.startsWith("/api/get-otp") || pathname.startsWith("/api/stream/") || pathname.includes(".mpd") || pathname.includes(".m3u8") || pathname.includes(".m4s") || pathname.includes(".mp4") || pathname.includes(".ts");
  try {
    const reqBodyBuf = (req.method !== "GET" && req.method !== "HEAD" && req.body)
      ? await req.arrayBuffer()
      : void 0;
    let upstreamRes = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: forwardHeaders,
      body: reqBodyBuf,
      redirect: "manual"
    });
    if (((upstreamRes.status === 307 || upstreamRes.status === 308) && upstreamRes.headers.get("location")?.includes("key-generate")) || (upstreamRes.status === 401 && pathname.startsWith("/api/stream/"))) {
      cachedAccessCookie = "";
      const newCookie = await getAccessCookie();
      forwardHeaders.set("cookie", [newCookie, ...extraIncomingCookies].filter(Boolean).join("; "));
      upstreamRes = await fetch(targetUrl.toString(), {
        method: req.method,
        headers: forwardHeaders,
        body: reqBodyBuf,
        redirect: "manual"
      });
    }
    const resHeaders = new Headers();
    upstreamRes.headers.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== "x-frame-options" &&
        lowerKey !== "content-security-policy" &&
        lowerKey !== "content-security-policy-report-only" &&
        lowerKey !== "set-cookie"
      ) {
        resHeaders.set(key, val);
      }
    });
    const upstreamSetCookies = typeof upstreamRes.headers.getSetCookie === "function"
      ? upstreamRes.headers.getSetCookie()
      : (upstreamRes.headers.get("set-cookie") ? [upstreamRes.headers.get("set-cookie")] : []);
    for (const rawCookie of upstreamSetCookies) {
      if (rawCookie) {
        resHeaders.append("Set-Cookie", rawCookie.replace(/domain=[^;]+;?/gi, "").replace(/Secure;?/gi, ""));
      }
    }
    resHeaders.set("Access-Control-Allow-Origin", "*");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    resHeaders.set("Access-Control-Allow-Headers", "*");
    const loc = upstreamRes.headers.get("location");
    if (loc) {
      let relativeLoc = loc.replace(/https?:\/\/(www\.)?learnxpw\.site/gi, "");
      if (relativeLoc.includes("key-generate")) {
        try {
          const locU = new URL(loc, TARGET_ORIGIN);
          relativeLoc = locU.searchParams.get("redirect") || "/study/batches";
        } catch {
          relativeLoc = "/study/batches";
        }
      }
      resHeaders.set("location", relativeLoc);
    }
    if (accessCookie) {
      resHeaders.append(
        "Set-Cookie",
        `${accessCookie}; Path=/; SameSite=Lax; Max-Age=86400`
      );
    }
    if (upstreamRes.status === 204 || upstreamRes.status === 205 || upstreamRes.status === 304) {
      return new Response(null, {
        status: upstreamRes.status,
        headers: resHeaders
      });
    }
    if (isDirectMedia) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: resHeaders
      });
    }
    const contentType = (resHeaders.get("content-type") || "").toLowerCase();
    const isText = contentType.includes("text/html") || contentType.includes("application/x-javascript") || contentType.includes("application/javascript") || contentType.includes("text/javascript") || contentType.includes("text/x-component") || contentType.includes("application/json") && !pathname.startsWith("/api/play");
    if (!isText) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: resHeaders
      });
    }
    const originalText = await upstreamRes.text();
    let modifiedText = transformText(originalText);
    if (isVideoFallbackApi && upstreamRes.status === 403 && modifiedText.includes("VIDEO_VERIFICATION_REQUIRED")) {
      modifiedText = modifiedText.replaceAll("VIDEO_VERIFICATION_REQUIRED", "STREAM_UNAVAILABLE");
    }
    resHeaders.delete("content-encoding");
    resHeaders.delete("content-length");
    resHeaders.delete("transfer-encoding");
    if (contentType.includes("text/html") || pathname.includes("/app/watch/layout") || pathname.includes("/app/live/layout") || pathname.includes("/app/contact/page")) {
      resHeaders.delete("etag");
      resHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
    }
    return new Response(modifiedText, {
      status: upstreamRes.status,
      headers: resHeaders
    });
  } catch (err) {
    return new Response(`[GB STUDY Edge Proxy Error]: ${err?.message || err}`, {
      status: 502,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
}
const onRequest = async (context) => {
  return handleEdgeRequest(context.request, context.env, context);
};
var path_default = {
  async fetch(request, env, ctx) {
    return handleEdgeRequest(request, env, ctx);
  }
};
export {
  path_default as default,
  handleEdgeRequest,
  onRequest
};
