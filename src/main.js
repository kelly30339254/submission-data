#!/usr/bin/env node
/**
 * 短篇小说收稿信息爬虫 - 主入口
 *
 * 功能：
 *   1. 小红书数据采集（双通道）：
 *      - 免费通道（默认）：explore 推荐流 + 关键词过滤 + 详情页深挖（无需登录）
 *      - 精确通道（可选）：GuaiKei 搜索 API（配置 GUAIKEI_API_TOKEN 后启用，可精确搜索关键词）
 *   2. 网页搜索（Bing，无需 token）
 *   3. 自动提取：编辑、邮箱、平台、收稿方向、微信号
 *   4. 导出 JSON / CSV / Excel
 *
 * 用法：
 *   node src/main.js                       # 全量（小红书免费通道 + 网页）
 *   node src/main.js --xhs-only            # 仅小红书
 *   node src/main.js --web-only            # 仅网页
 *   node src/main.js --limit 20            # 每个关键词返回数量
 *   node src/main.js --strict              # 仅保留含收稿信息的条目
 *   node src/main.js --pages 3             # 小红书推荐流抓取页数
 *   node src/main.js --output ./output     # 自定义输出目录
 */

const fs = require("fs");
const path = require("path");
const { XHS_KEYWORDS, WEB_KEYWORDS, SOGOU_KEYWORDS } = require("../config/keywords");
const xhs = require("./xiaohongshu");
const xhsDirect = require("./xhs-direct");
const web = require("./websearch");
const { extractItems } = require("./extractor");
const { exportJSON, exportCSV, exportExcel, ensureDir } = require("./exporter");

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = {
    xhs: true,
    web: true,
    limit: 10,
    output: "./output",
    verbose: true,
    strict: false,
    pages: 2,
    maxDetail: 12,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--xhs-only") { args.web = false; }
    else if (a === "--web-only") { args.xhs = false; }
    else if (a === "--limit") { args.limit = parseInt(argv[++i], 10) || 10; }
    else if (a === "--output") { args.output = argv[++i]; }
    else if (a === "--strict") { args.strict = true; }
    else if (a === "--pages") { args.pages = parseInt(argv[++i], 10) || 2; }
    else if (a === "--max-detail") { args.maxDetail = parseInt(argv[++i], 10) || 12; }
    else if (a === "--quiet") { args.verbose = false; }
    else if (a === "--help" || a === "-h") { args.help = true; }
  }
  return args;
}

function printHelp() {
  console.log(`
短篇小说收稿信息爬虫

用法:
  node src/main.js [选项]

选项:
  --xhs-only        仅采集小红书（推荐流 + 详情页）
  --web-only        仅搜索网页（Bing，无需 token）
  --limit <n>       每个网页关键词返回条数（默认 10）
  --pages <n>       小红书推荐流抓取页数（每页约30条，默认 2）
  --max-detail <n>  小红书详情页深挖数量上限（默认 12）
  --output <dir>    输出目录（默认 ./output）
  --strict          仅保留含收稿/邮箱/编辑/微信号的结果
  --quiet           关闭详细日志
  --help            显示帮助

小红书说明:
  免费通道无需登录，通过推荐流+关键词过滤+详情页提取（无法精确关键词搜索）。
  若配置 GUAIKEI_API_TOKEN（.env 文件），将自动改用精确搜索 API。
`);
}

const log = (msg, args) => {
  if (args.verbose) console.log(msg);
};

// ---------- 收集数据 ----------

/**
 * 小红书免费通道：推荐流 + 关键词过滤 + 详情页深挖
 */
async function collectXHSFree(args) {
  const results = [];
  const filterWords = ["收稿", "约稿", "征稿", "投稿", "征集", "求稿", "编辑", "邮箱"];
  console.log(`[小红书·免费] 抓取推荐流 ${args.pages} 页，关键词过滤: ${filterWords.join("/")}`);

  let result;
  try {
    result = await xhsDirect.crawlXHS({
      keywordFilter: filterWords,
      maxNotes: args.pages * 30,
      maxDetail: args.maxDetail,
      pages: args.pages,
    });
  } catch (e) {
    console.error(`[小红书·免费] 采集失败: ${e.message}`);
    return results;
  }

  // 汇总：命中关键词的笔记（含详情）作为主结果，其余推荐流仅记录标题
  for (const item of result.matched) {
    results.push({
      source: "xiaohongshu",
      keyword: "(推荐流命中)",
      title: item.title,
      author: item.author,
      url: item.url,
      id: item.id,
      likes: item.likes,
      desc: item.detail ? item.detail.desc : "",
      pageText: item.detail ? item.detail.desc : "",
      publishTime: item.detail ? item.detail.time : "",
      isSubmission: true,
    });
  }
  for (const d of result.details) {
    // 已覆盖的跳过
    if (result.matched.some((m) => m.id === d.id)) continue;
    results.push({
      source: "xiaohongshu",
      keyword: "(详情深挖)",
      title: d.title || d.detail.title,
      author: d.detail.author || d.author,
      url: d.url,
      id: d.id,
      likes: d.likes,
      desc: d.detail.desc || "",
      pageText: d.detail.desc || "",
      publishTime: d.detail.time || "",
    });
  }
  // 推荐流原始列表（仅标题，供观察）
  results.rawFeed = result.feed;

  console.log(
    `[小红书·免费] 推荐流 ${result.feed.length} 条 | 关键词命中 ${result.matched.length} 条 | 详情抓取 ${result.details.length} 条`
  );
  return results;
}

/**
 * 小红书精确通道：GuaiKei API（需 token）
 */
async function collectXHS(args) {
  const results = [];
  log(`[小红书] 开始搜索 ${XHS_KEYWORDS.length} 个关键词...`, args);
  for (const kw of XHS_KEYWORDS) {
    try {
      log(`[小红书] 搜索 "${kw}" (limit=${args.limit})`, args);
      const notes = await xhs.searchNotes(kw, { limit: args.limit });
      const items = notes.map((n) => ({
        source: "xiaohongshu",
        keyword: kw,
        ...n,
      }));
      results.push(...items);
      log(`[小红书] "${kw}" 返回 ${notes.length} 条`, args);
    } catch (e) {
      console.error(`[小红书] "${kw}" 失败: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  log(`[小红书] 共获取 ${results.length} 条`, args);
  return results;
}

async function collectWeb(args) {
  const results = [];
  const maxDetail = 3; // 每个关键词最多抓取的详情页数
  log(`[网页] 开始搜索 ${WEB_KEYWORDS.length} 个关键词...`, args);
  for (const kw of WEB_KEYWORDS) {
    try {
      log(`[网页] 搜索 "${kw}"`, args);
      const hits = await web.bingSearch(kw, args.limit);
      const items = [];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const item = { source: "web", keyword: kw, ...h, pageText: "" };
        // 抓取前 N 条详情页正文，用于提取邮箱等深度信息
        if (i < maxDetail && /^https?:\/\//.test(h.link) && !/\.(pdf|zip|doc|docx|jpg|png)(\?|$)/i.test(h.link)) {
          try {
            const page = await web.fetchPageText(h.link);
            item.pageText = page.text;
            if (page.title && !item.title) item.title = page.title;
            if (!item.snippet) item.snippet = page.text.slice(0, 200);
          } catch (e) {
            log(`[网页] 详情抓取失败: ${h.link} (${e.message})`, args);
          }
          await new Promise((r) => setTimeout(r, 600));
        }
        items.push(item);
      }
      results.push(...items);
      log(`[网页] "${kw}" 返回 ${hits.length} 条`, args);
    } catch (e) {
      console.error(`[网页] "${kw}" 失败: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  log(`[网页] 共获取 ${results.length} 条`, args);
  return results;
}

/**
 * 搜狗微信搜索：公众号约稿函（收稿邮箱/编辑信息的核心来源）
 */
async function collectSogou(args) {
  const results = [];
  log(`[搜狗微信] 开始搜索 ${SOGOU_KEYWORDS.length} 个关键词...`, args);
  for (const kw of SOGOU_KEYWORDS) {
    try {
      log(`[搜狗微信] 搜索 "${kw}"`, args);
      const hits = await web.sogouWeixinSearch(kw, args.limit);
      for (const h of hits) {
        results.push({
          source: "sogou",
          keyword: kw,
          title: h.title,
          link: h.link,
          snippet: h.snippet,
          desc: h.snippet,
          pageText: h.snippet,
        });
      }
      log(`[搜狗微信] "${kw}" 返回 ${hits.length} 条`, args);
    } catch (e) {
      console.error(`[搜狗微信] "${kw}" 失败: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  log(`[搜狗微信] 共获取 ${results.length} 条`, args);
  return results;
}

// ---------- 汇总导出 ----------
function buildSummary(allItems, args) {
  const total = allItems.length;
  const withEmail = allItems.filter((i) => (i.emails || []).length > 0);
  const withEditor = allItems.filter((i) => (i.editors || []).length > 0);
  const withPlatform = allItems.filter((i) => (i.platforms || []).length > 0);
  const withDirection = allItems.filter((i) => (i.directions || []).length > 0);

  // 平台统计
  const platformCount = {};
  for (const it of allItems) {
    for (const p of it.platforms || []) {
      platformCount[p] = (platformCount[p] || 0) + 1;
    }
  }

  // 方向统计
  const directionCount = {};
  for (const it of allItems) {
    for (const d of it.directions || []) {
      directionCount[d] = (directionCount[d] || 0) + 1;
    }
  }

  // 去重：以 url + title 为 key
  const seen = new Set();
  const deduped = [];
  for (const it of allItems) {
    const key = (it.url || "") + "|" + (it.title || "");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(it);
    }
  }

  return {
    generatedAt: new Date().toLocaleString(),
    params: { xhs: args.xhs, web: args.web, limit: args.limit, pages: args.pages },
    stats: {
      total: total,
      deduped: deduped.length,
      withEmail: withEmail.length,
      withEditor: withEditor.length,
      withPlatform: withPlatform.length,
      withDirection: withDirection.length,
      platformCount: Object.entries(platformCount).sort((a, b) => b[1] - a[1]),
      directionCount: Object.entries(directionCount).sort((a, b) => b[1] - a[1]),
    },
    items: deduped,
  };
}

// ---------- 主流程 ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureDir(args.output);
  const start = Date.now();
  console.log("========== 短篇小说收稿信息爬虫 ==========");

  // 检查 token：有 token 用精确搜索，无 token 用免费通道
  let hasXhsToken = false;
  if (args.xhs) {
    hasXhsToken = xhs.isValidToken(xhs.loadToken());
    if (hasXhsToken) {
      console.log("[小红书] 检测到有效 token，使用精确关键词搜索。");
    } else {
      console.log(
        "[小红书] 未配置 token，使用免费通道（推荐流+详情页深挖，无需登录）。\n" +
          "         如需精确关键词搜索，可在 .env 中配置 GUAIKEI_API_TOKEN。"
      );
    }
  }

  // 并行收集
  const tasks = [];
  if (args.xhs) {
    tasks.push(hasXhsToken ? collectXHS(args) : collectXHSFree(args));
  }
  if (args.web) {
    tasks.push(collectWeb(args));
    tasks.push(collectSogou(args)); // 搜狗微信搜索（公众号约稿函）
  }
  const collected = await Promise.all(tasks);
  const rawItems = collected.flat();

  // 提取结构化信息
  let allItems = extractItems(rawItems, {
    source: "auto",
  }).map((item) => {
    // 补充来源字段
    const raw = rawItems.find((r) => r.url === item.url || r.title === item.title);
    item.source = raw ? raw.source : item.source;
    return item;
  });

  // 严格模式：仅保留真正含收稿信息的结果
  if (args.strict) {
    const before = allItems.length;
    allItems = allItems.filter(
      (i) =>
        i.isSubmission ||
        (i.emails && i.emails.length > 0) ||
        (i.editors && i.editors.length > 0) ||
        (i.wechats && i.wechats.length > 0)
    );
    log(`[过滤] 严格模式：${before} -> ${allItems.length} 条`, args);
  }

  // 汇总
  const summary = buildSummary(allItems, args);

  // 导出时去掉内部字段 pageText；超长链接（如搜狗跳转）截断显示
  const exportItems = summary.items.map(({ pageText, url, ...rest }) => {
    const trimmedUrl = url && url.length > 260 ? url.slice(0, 260) + "..." : url;
    return { ...rest, url: trimmedUrl };
  });

  // 输出
  const base = path.join(args.output, `submission_${new Date().toISOString().slice(0, 10)}`);
  const jsonPath = exportJSON({ ...summary, items: exportItems }, `${base}.json`);
  const csvHeaders = [
    "source", "keyword", "title", "author", "editors", "emails", "wechats",
    "platforms", "directions", "likes", "collects", "comments",
    "publishTime", "url",
  ];
  const csvPath = exportCSV(exportItems, `${base}.csv`, csvHeaders);
  const xlsPath = exportExcel(exportItems, `${base}.xls`, csvHeaders);

  console.log("\n========== 搜索完成 ==========");
  console.log(`耗时: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`抓取总数: ${summary.stats.total}`);
  console.log(`去重后: ${summary.stats.deduped}`);
  console.log(`含邮箱: ${summary.stats.withEmail}`);
  console.log(`含编辑: ${summary.stats.withEditor}`);
  console.log(`含平台: ${summary.stats.withPlatform}`);
  console.log(`含方向: ${summary.stats.withDirection}`);
  if (summary.stats.platformCount.length) {
    console.log("\n平台分布:", summary.stats.platformCount.map(([p, c]) => `${p}(${c})`).join(" "));
  }
  if (summary.stats.directionCount.length) {
    console.log("方向分布:", summary.stats.directionCount.map(([d, c]) => `${d}(${c})`).join(" "));
  }
  console.log("\n导出文件:");
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV : ${csvPath}`);
  console.log(`  Excel: ${xlsPath}`);
}

main().catch((e) => {
  console.error("程序错误:", e.message);
  process.exit(1);
});
