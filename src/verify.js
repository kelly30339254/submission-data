/**
 * 编辑核实工具
 * 通过搜狗微信/网页搜索，按平台聚合获取最新收稿动态，
 * 提取编辑名、邮箱、QQ、收稿方向、收稿状态，与旧数据对比。
 */

const fs = require("fs");
const path = require("path");
const web = require("./websearch");
const { THEME_DIRECTIONS } = require("../config/keywords");

// ---------- 文本处理 ----------
function unique(arr) {
  return [...new Set(arr.filter(Boolean).map((s) => s.trim()).filter((s) => s.length > 0))];
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const QQ_RE = /(?:QQ|qq|企鹅)[：:\s]*([1-9][0-9]{5,11})/g;

/**
 * 从文本提取收稿方向关键词
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

/**
 * 从文本提取收稿状态
 * 优先"停止/不收"信号，其次"正常/收稿中"
 */
function extractStatus(text) {
  if (!text) return null;
  const stopSignals = [
    /停止收稿/, /暂不?收稿/, /不收稿/, /暂停收稿/, /已截止/, /截止投稿/, /停收/, /不收.*稿/,
    /停止征稿/, /暂停征稿/, /不约稿/, /暂停约稿/,
  ];
  const activeSignals = [
    /正常收稿/, /收稿中/, /长期收稿/, /持续收稿/, /火热收稿/, /大力收稿/, /急收/, /缺稿/,
    /收稿啦/, /收稿!/, /征稿中/, /约稿中/, /长期有效/, /长期征稿/, /长期约稿/, /火热征稿/,
  ];
  if (stopSignals.some((r) => r.test(text))) return "停止收稿";
  if (activeSignals.some((r) => r.test(text))) return "正常收稿";
  return null;
}

/**
 * 从摘要中提取编辑名（结合平台上下文）
 * 模式：平台+编辑名+收稿、编辑名:邮箱/QQ 等
 */
function extractEditorsFromText(text, platform) {
  const found = [];
  const NAME = "[\\u4e00-\\u9fa5A-Za-z_]{2,10}";
  const patterns = [
    // XX平台 + 编辑名 + 收稿
    new RegExp(`${platform}\\s*(${NAME})\\s*(?:收稿|约稿|征稿|编辑|开收|来收)`, "g"),
    // 编辑名：QQ/邮箱
    new RegExp(`(${NAME})[：:\\s]*(?:QQ|qq|邮箱|联系方式)`, "g"),
    // 编辑 名 收稿
    new RegExp(`(?:编辑|责编|主编)[：:\\s]*(${NAME})`, "g"),
    // 我是XX / 我是编辑XX
    new RegExp(`(?:我是|我是编辑|我是责编)(${NAME})`, "g"),
    // 收稿编辑：XX
    new RegExp(`(?:收稿编辑|收稿)编辑[：:\\s]*(${NAME})`, "g"),
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const name = m[1];
      if (
        name &&
        name.length >= 2 &&
        name.length <= 10 &&
        !/^(收稿|约稿|征稿|编辑|邮箱|联系|微信|QQ|投稿|老师|平台|类型|方向|要求|方式|联系方式|小说|故事|短篇|长篇|短剧|中篇|千字|本|作品|稿|我们|我|你|他|她|题材|全品类|男频|女频)$/.test(name) &&
        !/(平台|邮箱|联系|方式|类型|方向|要求|编辑|收稿|投稿|小说|故事|千字)/.test(name)
      ) {
        found.push(name);
      }
    }
  }
  return unique(found);
}

/**
 * 从搜索文本中提取邮箱/QQ/微信
 */
function extractContacts(text) {
  const emails = unique((text.match(EMAIL_RE) || []).map((e) => e.replace(/END$/i, "")));
  const qqs = [];
  let m;
  while ((m = QQ_RE.exec(text)) !== null) qqs.push(m[1]);
  // 也识别纯 QQ 数字段（在"qq:"/"QQ："上下文外）
  const qqNums = text.match(/(?<![\d])[1-9][0-9]{5,11}(?![\d])/g) || [];
  return {
    emails: unique(emails),
    qqs: unique([...qqs, ...qqNums.filter((n) => text.match(new RegExp(`${n}\\s*@`)) === null)]).slice(0, 6),
  };
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

/**
 * 按平台聚合核实
 * @param {object} opts {platform, queries, limit, channels}
 * @returns {Promise<object>} 平台最新收稿信息
 */
async function verifyPlatform(opts) {
  const { platform, limit = 8, channels = ["sogou"] } = opts;
  const queries = [
    `${platform} 收稿 编辑`,
    `${platform} 约稿 短篇`,
    `${platform} 编辑 联系方式`,
  ];
  const gathered = [];
  for (const q of queries.slice(0, 2)) {
    for (const ch of channels) {
      try {
        let hits = [];
        if (ch === "sogou") hits = await web.sogouWeixinSearch(q, limit);
        else if (ch === "bing") hits = await web.bingSearch(q, limit);
        for (const h of hits) {
          gathered.push({
            title: h.title || "",
            snippet: h.snippet || "",
            text: `${h.title || ""} ${h.snippet || ""}`,
            link: h.link || "",
            channel: ch,
          });
        }
      } catch (e) {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 1300));
    }
  }
  // 汇总
  const allText = gathered.map((g) => g.text).join(" ");
  const editors = unique(
    gathered
      .map((g) => extractEditorsFromText(g.text, platform))
      .flat()
  );
  const contacts = extractContacts(allText);
  const directions = extractDirections(allText);
  const themeDirections = extractThemeDirections(allText);
  const status = extractStatus(allText);
  const isActive = gathered.some((g) => /收稿|约稿|征稿|投稿/.test(g.text));

  return {
    platform,
    status,
    directions,
    themeDirections,
    editors,
    emails: contacts.emails,
    qqs: contacts.qqs,
    isActive,
    sample: gathered
      .filter((g) => g.text.includes("收稿") || g.text.includes("约稿") || g.text.includes("征稿"))
      .slice(0, 3)
      .map((g) => ({ title: g.title, snippet: g.snippet.slice(0, 150) })),
    rawCount: gathered.length,
  };
}

/**
 * 批量核实多个平台（分批，支持进度保存）
 */
async function verifyMany(platforms, opts = {}) {
  const { batchSize = 5, resumeFile = "", quiet = false } = opts;
  const results = [];
  const done = new Set();
  if (resumeFile && fs.existsSync(resumeFile)) {
    const prev = JSON.parse(fs.readFileSync(resumeFile, "utf-8"));
    for (const r of prev) {
      done.add(r.platform);
      results.push(r);
    }
    if (!quiet) console.log(`[恢复] 已处理 ${done.size} 个平台`);
  }
  for (let i = 0; i < platforms.length; i += batchSize) {
    const batch = platforms.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (p) => {
        if (done.has(p)) return null;
        if (!quiet) console.log(`[核实] ${p} ...`);
        try {
          return await verifyPlatform({ platform: p, limit: 6 });
        } catch (e) {
          if (!quiet) console.error(`[核实] ${p} 失败: ${e.message}`);
          return { platform: p, status: null, error: e.message };
        }
      })
    );
    for (const r of batchResults) {
      if (r) {
        done.add(r.platform);
        results.push(r);
        if (resumeFile) {
          fs.writeFileSync(resumeFile, JSON.stringify(results, null, 2));
        }
      }
    }
    if (!quiet) console.log(`[进度] ${done.size}/${platforms.length}`);
  }
  return results;
}

module.exports = { verifyPlatform, verifyMany, extractDirections, extractThemeDirections, extractStatus, extractContacts, extractEditorsFromText };
