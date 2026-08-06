#!/usr/bin/env node
/**
 * 编辑收稿信息核实工具 - 主入口
 *
 * 功能：
 *   读取 submission-editors.json，按平台聚合通过搜狗微信/网页搜索获取最新收稿动态，
 *   提取编辑名、邮箱、QQ、收稿方向、收稿状态，与旧数据对比，产出核对报告。
 *
 * 用法：
 *   node src/verify-main.js                       # 全量核实（2487 编辑 / 876 平台）
 *   node src/verify-main.js --platforms 20        # 仅核实编辑数 TOP 20 的平台
 *   node src/verify-main.js --batch 3             # 每批并发平台数（默认 3，防止封禁）
 *   node src/verify-main.js --input xx.json       # 指定输入文件
 *   node src/verify-main.js --output ./verify-out # 输出目录
 *   node src/verify-main.js --status-only         # 只看状态变化
 */

const fs = require("fs");
const path = require("path");
const { verifyMany } = require("./verify");
const { compareEditors, buildReport } = require("./compare");
const { exportJSON, exportCSV, exportExcel, ensureDir } = require("./exporter");

// ---------- 参数 ----------
function parseArgs(argv) {
  const args = {
    input: "./submission-editors.json",
    output: "./verify-out",
    platforms: 0, // 0 = 全部
    batch: 3,
    limit: 6,
    statusOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--output") args.output = argv[++i];
    else if (a === "--platforms") args.platforms = parseInt(argv[++i], 10) || 0;
    else if (a === "--batch") args.batch = parseInt(argv[++i], 10) || 3;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || 6;
    else if (a === "--status-only") args.statusOnly = true;
    else if (a === "--help" || a === "-h") { args.help = true; }
  }
  return args;
}

function printHelp() {
  console.log(`
编辑收稿信息核实工具

用法:
  node src/verify-main.js [选项]

选项:
  --input <file>      编辑数据文件（默认 ./submission-editors.json）
  --output <dir>      输出目录（默认 ./verify-out）
  --platforms <n>     仅核实编辑数 TOP n 的平台（0=全部，默认 0）
  --batch <n>         每批并发平台数（默认 3）
  --limit <n>         每个关键词返回条数（默认 6）
  --status-only       导出仅含状态/方向变化的精简报告
  --help              显示帮助
`);
}

// 使用 async 方式组织主流程
async function mainAsync() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  ensureDir(args.output);
  const start = Date.now();

  if (!fs.existsSync(args.input)) {
    console.error("找不到输入文件:", args.input);
    process.exit(1);
  }
  const editors = JSON.parse(fs.readFileSync(args.input, "utf-8"));
  console.log(`[输入] 加载 ${editors.length} 名编辑`);

  const platformCount = {};
  for (const e of editors) {
    const p = e.platform || "未知";
    platformCount[p] = (platformCount[p] || 0) + 1;
  }
  const sortedPlatforms = Object.entries(platformCount)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
  console.log(`[平台] 共 ${sortedPlatforms.length} 个平台`);

  let targetPlatforms = sortedPlatforms;
  if (args.platforms > 0) {
    targetPlatforms = sortedPlatforms.slice(0, args.platforms);
    console.log(`[平台] 仅核实 TOP ${args.platforms} 个平台`);
  }

  console.log("[开始] 按平台聚合搜索最新收稿动态...");
  const resumeFile = path.join(args.output, "progress.json");
  const results = await verifyMany(targetPlatforms, {
    batchSize: args.batch,
    resumeFile,
    quiet: false,
  });
  console.log(`[核实] 完成 ${results.length} 个平台`);

  // 4. 对比
  console.log("[对比] 新旧数据匹配分析...");
  const compareResult = compareEditors(editors, results);
  const report = buildReport(compareResult);
  const st = report.stats;
  console.log(`\n========== 核实报告 ==========`);
  console.log(`编辑总数: ${st.total}`);
  console.log(`已核实(平台有动态): ${st.verified}`);
  console.log(`状态变化: ${st.statusChanged}`);
  console.log(`方向变化: ${st.directionChanged}`);
  console.log(`任一项变化: ${st.anyChanged}`);
  console.log(`精确匹配(编辑名/邮箱/QQ): ${st.editorMatched}`);
  console.log(`平台级匹配: ${st.platformMatched}`);
  console.log(`未匹配: ${st.notMatched}`);

  // 5. 导出
  const base = path.join(args.output, `verify_${new Date().toISOString().slice(0, 10)}`);
  if (args.statusOnly) {
    const changed = report.changedItems.map((i) => ({
      id: i.id, name: i.name, platform: i.platform,
      oldStatus: i.oldStatus, newStatus: i.newStatus, statusChanged: i.statusChanged,
      oldDirections: i.oldDirections.join("/"), newDirections: i.newDirections.join("/"),
      directionChanged: i.directionChanged, matchLevel: i.matchLevel,
      email: i.email, qq: i.qq,
    }));
    const jsonPath = exportJSON({ stats: st, items: changed }, `${base}_changed.json`);
    const csvHeaders = ["id","name","platform","oldStatus","newStatus","statusChanged","oldDirections","newDirections","directionChanged","matchLevel","email","qq"];
    exportCSV(changed, `${base}_changed.csv`, csvHeaders);
    exportExcel(changed, `${base}_changed.xls`, csvHeaders);
    console.log("\n变化报告:", jsonPath);
  } else {
    const jsonPath = exportJSON(report, `${base}.json`);
    const csvHeaders = ["id","name","platform","oldStatus","newStatus","statusChanged","oldDirections","newDirections","directionChanged","matchLevel","editorMentioned","platformActive","verified","email","qq"];
    exportCSV(report.all, `${base}.csv`, csvHeaders);
    exportExcel(report.all, `${base}.xls`, csvHeaders);
    console.log("\n完整报告:");
    console.log("  JSON:", jsonPath);
    console.log("  CSV :", `${base}.csv`);
    console.log("  Excel:", `${base}.xls`);
  }
  console.log(`\n耗时: ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

// 移除同步 main()，直接调用异步主流程
mainAsync().catch((e) => {
  console.error("程序错误:", e.message);
  process.exit(1);
});
