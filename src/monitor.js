/**
 * 公众号收稿动态监测模块
 * 按平台聚合搜索公众号约稿函，保存快照并检测更新
 */

const fs = require("fs");
const path = require("path");
const web = require("./websearch");
const { THEME_DIRECTIONS } = require("../config/keywords");

function unique(arr) {
  return [...new Set(arr.filter(Boolean).map((s) => s.trim()).filter((s) => s.length > 0))];
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const QQ_RE = /(?:QQ|qq|企鹅)[：:\s]*([1-9][0-9]{5,11})/g;

/**
 * 从文本提取收稿方向
 */
const DIRECTION_KEYWORDS = {
  短剧: ["短剧"],
  短篇: ["短篇", "短故事", "短篇故事"],
  中短篇: ["中短篇", "中短"],
  超短篇: ["超短篇", "超短", "微短篇"],
  中篇: ["中篇"],
  长篇: ["长篇"],
  漫剧: ["漫剧", "漫画剧本"],
};

function extractDirections(text) {
  if (!text) return [];
  const found = new Set();
  for (const [dir, kws] of Object.entries(DIRECTION_KEYWORDS)) {
    if (kws.some((k) => text.includes(k))) found.add(dir);
  }
  return [...found];
}

function extractStatus(text) {
  if (!text) return null;
  const stopSignals = [/停止收稿/, /暂不?收稿/, /不收稿/, /暂停收稿/, /已截止/, /停收/, /停止征稿/, /暂停征稿/, /不约稿/, /暂停约稿/];
  const activeSignals = [/正常收稿/, /收稿中/, /长期收稿/, /持续收稿/, /火热收稿/, /大力收稿/, /急收/, /缺稿/, /收稿啦/, /收稿!/, /征稿中/, /约稿中/, /长期有效/, /长期征稿/, /长期约稿/, /火热征稿/];
  if (stopSignals.some((r) => r.test(text))) return "停止收稿";
  if (activeSignals.some((r) => r.test(text))) return "正常收稿";
  return null;
}

/**
 * 从文本提取题材方向（世情/追妻/虐文等）
 */
function extractThemeDirections(text) {
  if (!text) return [];
  const found = new Set();
  for (const [theme, kws] of Object.entries(THEME_DIRECTIONS)) {
    if (kws.some((k) => text.includes(k))) found.add(theme);
  }
  return [...found];
}

function extractContacts(text) {
  const emails = unique((text.match(EMAIL_RE) || []).map((e) => e.replace(/END$/i, "")));
  const qqs = [];
  let m;
  while ((m = QQ_RE.exec(text)) !== null) qqs.push(m[1]);
  return { emails, qqs: unique(qqs).slice(0, 8) };
}

/**
 * 从摘要提取编辑名
 */
const NAME = "[\\u4e00-\\u9fa5A-Za-z_]{2,10}";
function extractEditors(text, platform) {
  const found = [];
  const patterns = [
    new RegExp(`${platform}\\s*(${NAME})\\s*(?:收稿|约稿|征稿|编辑|开收|来收)`, "g"),
    new RegExp(`(${NAME})[：:\\s]*(?:QQ|qq|邮箱|联系方式)`, "g"),
    new RegExp(`(?:编辑|责编|主编)[：:\\s]*(${NAME})`, "g"),
    new RegExp(`(?:我是|我是编辑|我是责编)(${NAME})`, "g"),
  ];
  for (const pat of patterns) {
    let mm;
    while ((mm = pat.exec(text)) !== null) {
      const n = mm[1];
      if (n && n.length >= 2 && n.length <= 10 && !/(平台|邮箱|联系|方式|类型|方向|要求|编辑|收稿|投稿|小说|故事|千字)/.test(n) && !/^(收稿|约稿|征稿|编辑|邮箱|联系|微信|QQ|投稿|老师|平台|类型|方向|要求|小说|故事|短篇|长篇|短剧|中篇|千字)$/.test(n)) {
        found.push(n);
      }
    }
  }
  return unique(found);
}

/**
 * 抓取单个平台的公众号收稿动态
 * @param {string} platform
 * @param {object} opts {limit, delayMs}
 */
async function monitorPlatform(platform, opts = {}) {
  const { limit = 8, delayMs = 2000 } = opts;
  const queries = [
    `${platform} 收稿 编辑`,
    `${platform} 约稿 短篇`,
  ];
  const items = [];
  let blocked = false;

  for (const q of queries) {
    try {
      const hits = await web.sogouWeixinSearch(q, limit);
      if (hits.blocked) {
        blocked = true;
        break;
      }
      for (const h of hits) {
        items.push({
          title: h.title,
          snippet: h.snippet || "",
          account: h.account || "",
          link: h.link || "",
          query: q,
        });
      }
    } catch (e) {
      // 单次失败继续
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // 汇总
  const allText = items.map((i) => i.title + " " + i.snippet).join(" ");
  const result = {
    platform,
    checkedAt: new Date().toISOString(),
    blocked,
    isActive: items.some((i) => /收稿|约稿|征稿|投稿/.test(i.title + " " + i.snippet)),
    status: extractStatus(allText),
    directions: extractDirections(allText),
    themeDirections: extractThemeDirections(allText),
    editors: extractEditors(allText, platform),
    emails: extractContacts(allText).emails,
    qqs: extractContacts(allText).qqs,
    accounts: unique(items.map((i) => i.account).filter(Boolean)),
    items: items.map((i) => ({
      title: i.title,
      account: i.account,
      snippet: i.snippet.slice(0, 120),
      link: i.link,
    })),
  };
  return result;
}

/**
 * 加载历史快照
 */
function loadSnapshot(snapshotFile) {
  if (!snapshotFile || !fs.existsSync(snapshotFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(snapshotFile, "utf-8"));
  } catch (e) {
    return null;
  }
}

/**
 * 对比两个快照，找出更新项
 * @param {object} oldSnap 旧快照 {platforms: {...}}
 * @param {object} newSnap 新快照
 */
function diffSnapshots(oldSnap, newSnap) {
  const oldPlatforms = (oldSnap && oldSnap.platforms) || {};
  const updates = [];
  const newItems = newSnap.platforms || {};

  for (const [platform, cur] of Object.entries(newItems)) {
    const prev = oldPlatforms[platform];
    if (!prev) {
      // 全新平台
      if (cur.isActive) {
        updates.push({ platform, type: "new_platform", ...cur });
      }
      continue;
    }
    // 动态变化检测
    const prevTitles = new Set((prev.items || []).map((i) => i.title));
    const newOnes = (cur.items || []).filter((i) => !prevTitles.has(i.title));
    // 方向/状态变化
    const directionChanged = JSON.stringify((prev.directions || []).sort()) !== JSON.stringify((cur.directions || []).sort());
    const statusChanged = prev.status !== cur.status;
    const editorAdded = (cur.editors || []).some((e) => !(prev.editors || []).includes(e));

    if (newOnes.length > 0 || directionChanged || statusChanged || editorAdded) {
      updates.push({
        platform,
        type: "updated",
        statusChanged,
        directionChanged,
        editorAdded,
        newCount: newOnes.length,
        newItems: newOnes.map((i) => ({ title: i.title, account: i.account || "", snippet: (i.snippet || "").slice(0, 100), link: i.link || "" })),
        oldStatus: prev.status || "",
        newStatus: cur.status || "",
        oldDirections: prev.directions || [],
        newDirections: cur.directions || [],
        editors: cur.editors || [],
        accounts: cur.accounts || [],
      });
    }
  }

  // 失效检测：旧平台现在没动态了
  const inactiveNow = [];
  for (const [platform, prev] of Object.entries(oldPlatforms)) {
    if (prev.isActive && newItems[platform] && !newItems[platform].isActive) {
      inactiveNow.push({ platform, oldStatus: prev.status, oldDirections: prev.directions, note: "不再检索到收稿动态" });
    }
  }

  return { updates, inactiveNow };
}

/**
 * 批量监测多个平台
 * @param {Array} platforms
 * @param {object} opts {batchSize, snapshotFile, delayMs, limit, retryDelayMs}
 */
async function monitorMany(platforms, opts = {}) {
  const { batchSize = 2, snapshotFile = "", delayMs = 2000, limit = 8, quiet = false, retryDelayMs = 60000 } = opts;

  // 加载旧快照
  const oldSnap = loadSnapshot(snapshotFile);
  if (oldSnap && !quiet) {
    console.log(`[快照] 上次监测时间: ${oldSnap.generatedAt || "未知"}, 平台数: ${Object.keys(oldSnap.platforms || {}).length}`);
  }

  const result = { platforms: {} };
  let blockedCount = 0;

  for (let i = 0; i < platforms.length; i += batchSize) {
    const batch = platforms.slice(i, i + batchSize);
    const batchRes = await Promise.all(
      batch.map(async (p) => {
        if (!quiet) console.log(`[监测] ${p} ...`);
        try {
          return await monitorPlatform(p, { limit, delayMs });
        } catch (e) {
          if (!quiet) console.error(`[监测] ${p} 失败: ${e.message}`);
          return { platform: p, blocked: false, isActive: false, error: e.message, items: [] };
        }
      })
    );
    for (const r of batchRes) {
      result.platforms[r.platform] = r;
      if (r.blocked) blockedCount++;
    }
    if (!quiet) console.log(`[进度] ${Math.min(i + batchSize, platforms.length)}/${platforms.length} (风控 ${blockedCount})`);

    // 风控降速：整批被拦截时等待冷却，避免浪费请求
    if (blockedCount > 0 && blockedCount >= i + batchSize && i + batchSize < platforms.length) {
      if (!quiet) console.log(`[风控] 检测到拦截，冷却 ${Math.round(retryDelayMs / 1000)}s 后继续...`);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  // 对比
  const diff = diffSnapshots(oldSnap, result);

  // 保存新快照
  const snapshot = {
    generatedAt: new Date().toLocaleString(),
    platforms: result.platforms,
  };
  if (snapshotFile) {
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
  }

  return { snapshot, updates: diff.updates, inactiveNow: diff.inactiveNow, blockedCount };
}

module.exports = { monitorPlatform, monitorMany, diffSnapshots, extractDirections, extractThemeDirections, extractStatus, extractContacts, extractEditors };
