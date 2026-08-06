/**
 * 生成核对摘要报告（markdown）
 * 用法: node src/report.js <verify-json> [输出路径]
 */

const fs = require("fs");
const path = require("path");

function buildMarkdown(report) {
  const st = report.stats;
  const L = [];
  L.push(`# 短篇小说收稿编辑核对报告`);
  L.push(``);
  L.push(`> 生成时间：${report.generatedAt}`);
  L.push(`> 数据来源：搜狗微信搜索（公众号约稿函）+ 编辑列表匹配`);
  L.push(``);
  L.push(`## 总体统计`);
  L.push(``);
  L.push(`| 指标 | 数值 |`);
  L.push(`| --- | --- |`);
  L.push(`| 编辑总数 | ${st.total} |`);
  L.push(`| 已核实（平台有最新动态） | ${st.verified} |`);
  L.push(`| 未核实 | ${st.unverified} |`);
  L.push(`| 收稿状态发生变化 | **${st.statusChanged}** |`);
  L.push(`| 收稿方向发生变化 | **${st.directionChanged}** |`);
  L.push(`| 任一信息变化 | **${st.anyChanged}** |`);
  L.push(`| 精确匹配（姓名/邮箱/QQ） | ${st.editorMatched} |`);
  L.push(`| 平台级匹配 | ${st.platformMatched} |`);
  L.push(`| 未匹配 | ${st.notMatched} |`);
  L.push(``);

  const changed = report.changedItems;

  // 状态变化
  const statusChanges = changed.filter((i) => i.statusChanged);
  if (statusChanges.length) {
    L.push(`## 收稿状态变化（${statusChanges.length} 条）`);
    L.push(``);
    L.push(`| 编辑 | 平台 | 原状态 | 新状态 | 匹配 |`);
    L.push(`| --- | --- | --- | --- | --- |`);
    for (const i of statusChanges) {
      L.push(`| ${i.name} | ${i.platform} | ${i.oldStatus} | **${i.newStatus}** | ${i.matchLevel} |`);
    }
    L.push(``);
  }

  // 方向变化
  const dirChanges = changed.filter((i) => i.directionChanged);
  if (dirChanges.length) {
    L.push(`## 收稿方向变化（${dirChanges.length} 条）`);
    L.push(``);
    L.push(`| 编辑 | 平台 | 原方向 | 新方向 | 匹配 | 邮箱/QQ |`);
    L.push(`| --- | --- | --- | --- | --- | --- |`);
    const seen = new Set();
    for (const i of dirChanges) {
      const key = i.name + "|" + i.platform + "|" + (i.email || i.qq);
      if (seen.has(key)) continue;
      seen.add(key);
      L.push(
        `| ${i.name} | ${i.platform} | ${(i.oldDirections || []).join("/") || "-"} | ${(i.newDirections || []).join("/")} | ${i.matchLevel} | ${i.email || i.qq || "-"} |`
      );
    }
    L.push(``);
  }

  // 平台活跃状态
  L.push(`## 平台收稿动态`);
  L.push(``);
  L.push(`- **仍正常收稿的平台**：已通过搜狗微信核实到最新约稿/收稿动态。`);
  L.push(`- 核实方式：按平台聚合搜索"平台名+收稿/约稿"，从公众号约稿函中提取信息。`);
  L.push(``);
  L.push(`## 说明`);
  L.push(``);
  L.push(`- **精确匹配**（姓名/邮箱/QQ）：可确认该编辑个体信息更新（高置信）。`);
  L.push(`- **平台级匹配**：该平台有收稿动态，但无法确认每个编辑个体是否变动。`);
  L.push(`- **未核实**：未在搜狗微信中检索到该平台的收稿动态。`);
  L.push(``);
  return L.join("\n");
}

function main() {
  const input = process.argv[2] || "./verify-out/verify_2026-08-06.json";
  const output = process.argv[3] || input.replace(/\.json$/, ".md");
  const report = JSON.parse(fs.readFileSync(input, "utf-8"));
  const md = buildMarkdown(report);
  fs.writeFileSync(output, md, "utf-8");
  console.log("报告已生成:", output);
}

main();
