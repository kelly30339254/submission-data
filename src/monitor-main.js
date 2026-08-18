#!/usr/bin/env node
/**
 * 公众号收稿动态监测工具 - 主入口
 *
 * 功能：
 *   按平台自动搜索公众号收稿动态，保存快照，
 *   与上次对比检测：新动态 / 方向变化 / 状态变化 / 新编辑
 *
 * 用法：
 *   node src/monitor-main.js                          # 监测全部 1039 个平台
 *   node src/monitor-main.js --platforms 50           # 仅监测编辑数 TOP 50 平台
 *   node src/monitor-main.js --platforms 七猫,四季    # 监测指定平台（逗号分隔）
 *   node src/monitor-main.js --output ./monitor-out   # 输出目录
 *   node src/monitor-main.js --batch 2 --delay 2500   # 批次与请求间隔
 */

const fs = require("fs");
const path = require("path");
const { monitorMany } = require("./monitor");
const { exportJSON, exportCSV, exportExcel, ensureDir } = require("./exporter");

function parseArgs(argv) {
  const args = {
    input: "./submission-editors.json",
    output: "./monitor-out",
    platforms: 0,
    batch: 2,
    delay: 2500,
    limit: 8,
    snapshots: 5,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--output") args.output = argv[++i];
    else if (a === "--platforms") {
      const v = argv[++i];
      if (/^\d+$/.test(v)) args.platforms = parseInt(v, 10);
      else args.platformNames = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--batch") args.batch = parseInt(argv[++i], 10) || 2;
    else if (a === "--delay") args.delay = parseInt(argv[++i], 10) || 2500;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || 8;
    else if (a === "--retry-delay") args.retryDelay = parseInt(argv[++i], 10) || 60000;
    else if (a === "--snapshots") args.snapshots = parseInt(argv[++i], 10) || 5;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
公众号收稿动态监测工具

用法:
  node src/monitor-main.js [选项]

选项:
  --input <file>        编辑数据文件（默认 ./submission-editors.json）
  --output <dir>        输出目录（默认 ./monitor-out）
  --platforms <n|名单>   监测编辑数 TOP n 平台，或指定平台如"七猫,四季"
  --batch <n>           每批并发平台数（默认 2，降低风控风险）
  --delay <ms>          请求间隔毫秒（默认 2500）
  --limit <n>           每关键词返回条数（默认 8）
  --retry-delay <ms>    风控拦截后的冷却等待（默认 60000）
  --snapshots <n>       保留历史快照数（默认 5）
  --help                显示帮助
`);
}

function buildMarkdown(report, stats) {
  const L = [];
  L.push(`# 公众号收稿动态监测报告`);
  L.push(``);
  L.push(`> 生成时间：${new Date().toLocaleString()}`);
  L.push(`> 监测平台数：${stats.platforms}`);
  L.push(``);

  if (report.blockedCount > 0) {
    L.push(`> ⚠️ 注意：${report.blockedCount} 个平台请求触发风控（搜狗验证码），本次结果可能不完整，建议稍后重试。`);
    L.push(``);
  }

  const updates = report.updates;
  if (updates.length === 0) {
    L.push(`## 更新检测`);
    L.push(``);
    L.push(`本次未检测到新的收稿动态变化。`);
    L.push(``);
  } else {
    L.push(`## 本次更新（${updates.length} 条）`);
    L.push(``);

    // 状态变化
    const statusChanges = updates.filter((u) => u.statusChanged);
    if (statusChanges.length) {
      L.push(`### 收稿状态变化（${statusChanges.length}）`);
      L.push(``);
      L.push(`| 平台 | 原状态 | 新状态 | 公众号 | 编辑 |`);
      L.push(`| --- | --- | --- | --- | --- |`);
      for (const u of statusChanges) {
        L.push(`| ${u.platform} | ${u.oldStatus || "-"} | **${u.newStatus || "停止收稿"}** | ${(u.accounts || []).join("/") || "-"} | ${(u.editors || []).join("/") || "-"} |`);
      }
      L.push(``);
    }

    // 方向变化
    const dirChanges = updates.filter((u) => u.directionChanged);
    if (dirChanges.length) {
      L.push(`### 收稿方向变化（${dirChanges.length}）`);
      L.push(``);
      L.push(`| 平台 | 原方向 | 新方向 |`);
      L.push(`| --- | --- | --- |`);
      for (const u of dirChanges) {
        L.push(`| ${u.platform} | ${(u.oldDirections || []).join("/") || "-"} | **${(u.newDirections || []).join("/") || "-"}** |`);
      }
      L.push(``);
    }

    // 新动态
    const newOnes = updates.filter((u) => u.newCount > 0);
    if (newOnes.length) {
      L.push(`### 新发布收稿动态（${newOnes.length} 平台）`);
      L.push(``);
      for (const u of newOnes) {
        L.push(`**${u.platform}**：新增 ${u.newCount} 条动态`);
        L.push(``);
        for (const it of u.newItems.slice(0, 5)) {
          L.push(`- ${it.title}${it.account ? `（公众号：${it.account}）` : ""}`);
          if (it.snippet) L.push(`  > ${it.snippet}`);
        }
        L.push(``);
      }
    }
  }

  if (report.inactiveNow.length) {
    L.push(`## 疑似停止收稿（${report.inactiveNow.length}）`);
    L.push(``);
    L.push(`以下平台本次未检索到收稿动态：`);
    L.push(``);
    for (const i of report.inactiveNow) {
      L.push(`- ${i.platform}（原状态：${i.oldStatus || "-"}，原方向：${(i.oldDirections || []).join("/") || "-"}）`);
    }
    L.push(``);
  }

  L.push(`## 说明`);
  L.push(``);
  L.push(`- 数据来源：搜狗微信搜索（公众号约稿函）。`);
  L.push(`- "新增动态"= 与上次快照相比，平台新增的约稿/收稿文章标题。`);
  L.push(`- "方向变化"= 平台收稿方向关键词集合发生变化（短篇/长篇/短剧等）。`);
  L.push(`- 首次运行仅建立快照，第二次运行起开始检测差异。`);
  L.push(``);
  return L.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  ensureDir(args.output);
  const start = Date.now();
  console.log("========== 公众号收稿动态监测 ==========");

  // 平台列表
  const editors = JSON.parse(fs.readFileSync(args.input, "utf-8"));
  const platformCount = {};
  for (const e of editors) {
    const p = e.platform || "未知";
    platformCount[p] = (platformCount[p] || 0) + 1;
  }
  let targetPlatforms;
  if (args.platformNames) {
    targetPlatforms = args.platformNames;
    console.log(`[平台] 指定监测: ${targetPlatforms.join(", ")}`);
  } else {
    const sorted = Object.entries(platformCount).sort((a, b) => b[1] - a[1]).map(([p]) => p);
    targetPlatforms = args.platforms > 0 ? sorted.slice(0, args.platforms) : sorted;
    console.log(`[平台] ${targetPlatforms.length} 个平台（编辑数据共 ${editors.length} 名）`);
  }

  // 快照文件（按天轮转，保留最近 N 个）
  const dateStr = new Date().toISOString().slice(0, 10);
  const snapFile = path.join(args.output, `snapshot_${dateStr}.json`);
  try {
    const snaps = fs
      .readdirSync(args.output)
      .filter((f) => /^snapshot_\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse();
    for (const oldSnap of snaps.slice(args.snapshots)) {
      fs.unlinkSync(path.join(args.output, oldSnap));
    }
  } catch (e) { /* ignore */ }

  // 执行监测
  const report = await monitorMany(targetPlatforms, {
    batchSize: args.batch,
    delayMs: args.delay,
    limit: args.limit,
    snapshotFile: snapFile,
    retryDelayMs: args.retryDelay || 60000,
    quiet: false,
  });

  // 统计
  const stats = {
    platforms: targetPlatforms.length,
    checked: Object.keys(report.snapshot.platforms).length,
    active: Object.values(report.snapshot.platforms).filter((p) => p.isActive).length,
    updates: report.updates.length,
    statusChanged: report.updates.filter((u) => u.statusChanged).length,
    directionChanged: report.updates.filter((u) => u.directionChanged).length,
    newDynamic: report.updates.filter((u) => u.newCount > 0).length,
    inactive: report.inactiveNow.length,
    blocked: report.blockedCount,
  };

  console.log(`\n========== 监测完成 ==========`);
  console.log(`耗时: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`监测平台: ${stats.platforms}`);
  console.log(`有收稿动态: ${stats.active}`);
  console.log(`检测到更新: ${stats.updates}`);
  console.log(`  状态变化: ${stats.statusChanged}`);
  console.log(`  方向变化: ${stats.directionChanged}`);
  console.log(`  新动态平台: ${stats.newDynamic}`);
  console.log(`  疑似停止: ${stats.inactive}`);
  if (stats.blocked > 0) console.log(`  ⚠️ 风控平台: ${stats.blocked}（可稍后重试）`);

  // 导出
  const base = path.join(args.output, `monitor_${dateStr}`);
  exportJSON({ stats, ...report }, `${base}.json`);

  // CSV
  const csvRows = [];
  for (const u of report.updates) {
    csvRows.push({
      platform: u.platform,
      type: u.type,
      statusChanged: u.statusChanged,
      oldStatus: u.oldStatus || "",
      newStatus: u.newStatus || "",
      directionChanged: u.directionChanged,
      oldDirections: (u.oldDirections || []).join("/"),
      newDirections: (u.newDirections || []).join("/"),
      editorAdded: u.editorAdded,
      editors: (u.editors || []).join("/"),
      accounts: (u.accounts || []).join("/"),
      newCount: u.newCount || 0,
    });
  }
  if (csvRows.length) {
    const headers = ["platform", "type", "statusChanged", "oldStatus", "newStatus", "directionChanged", "oldDirections", "newDirections", "editorAdded", "editors", "accounts", "newCount"];
    exportCSV(csvRows, `${base}_updates.csv`, headers);
    exportExcel(csvRows, `${base}_updates.xls`, headers);
  }

  // 全部平台快照 CSV
  const allRows = Object.entries(report.snapshot.platforms).map(([p, r]) => ({
    platform: p,
    active: r.isActive,
    status: r.status || "",
    directions: (r.directions || []).join("/"),
    editors: (r.editors || []).join("/"),
    emails: (r.emails || []).join("/"),
    qqs: (r.qqs || []).join("/"),
    accounts: (r.accounts || []).join("/"),
    itemCount: (r.items || []).length,
    blocked: !!r.blocked,
  }));
  const allHeaders = ["platform", "active", "status", "directions", "editors", "emails", "qqs", "accounts", "itemCount", "blocked"];
  exportCSV(allRows, `${base}_platforms.csv`, allHeaders);

  // Markdown 报告
  const md = buildMarkdown(report, stats);
  fs.writeFileSync(`${base}.md`, md, "utf-8");

  console.log(`\n输出文件:`);
  console.log(`  完整报告: ${base}.md`);
  console.log(`  更新明细: ${base}_updates.csv`);
  console.log(`  平台快照: ${base}_platforms.csv`);
  console.log(`  数据快照: ${snapFile}`);
}

main().catch((e) => {
  console.error("程序错误:", e.message);
  process.exit(1);
});
