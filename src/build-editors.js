/**
 * 数据生成器：整合编辑数据 → 云端 editors-latest.json
 *
 * 输入：
 *   - submission-editors.json   (2979 名有效编辑基础数据)
 *   - verify-out/progress.json  (平台核实结果，含 themeDirections/status)
 * 输出：
 *   - editors-latest.json       (软件兼容的云端数据格式)
 *
 * 用法：
 *   node src/build-editors.js [--out ./editors-latest.json]
 */

const fs = require("fs");
const path = require("path");
const { THEME_DIRECTIONS } = require("../config/keywords");

// ---------- 参数 ----------
function parseArgs(argv) {
  const args = {
    editors: "./submission-editors.json",
    progress: "./verify-out/progress.json",
    out: "./editors-latest.json",
    dedup: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--editors") args.editors = argv[++i];
    else if (a === "--progress") args.progress = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--no-dedup") args.dedup = false;
  }
  return args;
}

// ---------- 题材方向提取 ----------
function extractThemeDirections(text) {
  if (!text) return [];
  const found = new Set();
  for (const [theme, kws] of Object.entries(THEME_DIRECTIONS)) {
    if (kws.some((k) => text.includes(k))) found.add(theme);
  }
  return [...found];
}

// 从 requirements 中提取"品类"（短篇/长篇/短剧等）
const CATEGORY_KEYWORDS = {
  短剧: ["短剧"],
  短篇: ["短篇", "短故事"],
  中短篇: ["中短篇", "中短"],
  超短篇: ["超短篇", "超短", "微短篇"],
  中篇: ["中篇"],
  长篇: ["长篇"],
  漫剧: ["漫剧"],
};
function extractCategories(text) {
  if (!text) return [];
  const found = new Set();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some((k) => text.includes(k))) found.add(cat);
  }
  return [...found];
}

// GitHub Actions 按 UTC 运行；数据面向国内用户，版本日期固定按北京时间计算。
function beijingDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

// ---------- 主流程 ----------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.editors)) {
    console.error("找不到编辑数据:", args.editors);
    process.exit(1);
  }
  const editors = JSON.parse(fs.readFileSync(args.editors, "utf-8"));

  // 平台核实结果（若存在；不存在时仅用基础数据生成）
  let platformInfo = {};
  if (fs.existsSync(args.progress)) {
    try {
      const progress = JSON.parse(fs.readFileSync(args.progress, "utf-8"));
      for (const p of progress) {
        if (p.platform) platformInfo[p.platform] = p;
      }
      console.log(`[输入] 平台核实结果 ${progress.length} 个`);
    } catch (e) {
      console.log("[输入] progress.json 解析失败，仅用基础数据");
    }
  } else {
    console.log("[输入] 未找到平台核实结果（首次运行），仅用基础数据生成");
  }

  // 生成
  const items = [];
  for (const e of editors) {
    const requirements = e.requirements || e.notes || "";
    const categories = e.workTypes && e.workTypes.length
      ? e.workTypes.join("/")
      : extractCategories(requirements).join("/");
    const themeFromReq = extractThemeDirections(requirements);
    // 平台级题材方向补充
    const pi = platformInfo[e.platform];
    const themeFromPlatform = pi && pi.themeDirections ? pi.themeDirections : [];
    const themes = [...new Set([...themeFromReq, ...themeFromPlatform])];

    // 状态：优先用核实结果，其次基础数据
    let status = e.status || "";
    if (pi && pi.status) status = pi.status;

    items.push({
      name: e.name || "",
      platform: e.platform || "",
      email: e.email || "",
      qq: e.qq || "",
      categories,                    // 品类：短篇/长篇/短剧/中短篇…
      themeDirections: themes,       // 题材方向：世情/追妻/虐文…
      status: status || "未核实",
      feeInfo: e.payment || "",
      requirements: requirements.slice(0, 500),
      updateTime: e["更新日期"] || e["收录日期"] || "",
    });
  }

  // 按邮箱去重
  let finalItems = items;
  if (args.dedup) {
    const seen = new Set();
    finalItems = items.filter((i) => {
      const key = i.email.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const withTheme = finalItems.filter((i) => i.themeDirections.length > 0).length;
  const stopped = finalItems.filter((i) => i.status === "停止收稿").length;

  // 打包
  const generatedAt = new Date();
  const payload = {
    version: beijingDate(generatedAt),
    generatedAt: generatedAt.toISOString(),
    total: finalItems.length,
    source: "搜狗微信·公众号约稿函 + 公开征稿信息",
    disclaimer: "数据来自公开征稿信息，投稿前请自行核实邮箱有效性",
    stats: {
      withThemeDirections: withTheme,
      stopped: stopped,
    },
    editors: finalItems,
  };

  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`\n[输出] ${args.out}`);
  console.log(`编辑总数: ${finalItems.length}`);
  console.log(`含题材方向: ${withTheme}`);
  console.log(`停止收稿: ${stopped}`);
  console.log(`文件大小: ${(fs.statSync(args.out).size / 1024).toFixed(1)} KB`);
}

main();
