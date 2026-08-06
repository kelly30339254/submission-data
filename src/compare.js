/**
 * 新旧数据对比模块
 * 将平台最新收稿信息与 submission-editors.json 中的编辑数据匹配，
 * 判断每个编辑的收稿方向/状态是否有更新。
 */

/**
 * 编辑匹配策略：
 * 1. 平台名相同 + 编辑名相同 → 高置信匹配
 * 2. 平台名相同 + 邮箱相同 → 高置信匹配
 * 3. 平台名相同 + QQ 相同 → 高置信匹配
 * 4. 平台名相同 → 平台级匹配（无法定位到具体编辑时，仅报告平台状态）
 */

function normalize(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * 将平台核实结果与编辑列表对比
 * @param {Array} editors 旧编辑列表
 * @param {Array} platformResults 平台核实结果
 */
function compareEditors(editors, platformResults) {
  const platformMap = {};
  for (const pr of platformResults) {
    if (!platformMap[pr.platform]) platformMap[pr.platform] = [];
    platformMap[pr.platform].push(pr);
  }

  const output = [];
  let matchCount = 0;
  let platformOnlyCount = 0;

  for (const editor of editors) {
    const platform = normalize(editor.platform);
    const name = normalize(editor.name);
    const email = normalize(editor.email);
    const qq = normalize(editor.qq);

    const prs = platformMap[platform] || [];

    // 收集该平台的所有新信息
    const newEmails = new Set();
    const newQqs = new Set();
    const newDirections = new Set();
    const newEditors = new Set();
    let newStatus = null;
    let platformActive = false;

    for (const pr of prs) {
      (pr.emails || []).forEach((e) => newEmails.add(normalize(e)));
      (pr.qqs || []).forEach((q) => newQqs.add(normalize(q)));
      (pr.directions || []).forEach((d) => newDirections.add(d));
      (pr.editors || []).forEach((e) => newEditors.add(normalize(e)));
      if (pr.status) newStatus = pr.status;
      if (pr.isActive) platformActive = true;
    }

    // 匹配级别
    let matchLevel = "none";
    if (email && newEmails.has(email)) matchLevel = "email";
    else if (qq && newQqs.has(qq)) matchLevel = "qq";
    else if (name && newEditors.has(name)) matchLevel = "name";
    else if (prs.length > 0) matchLevel = "platform";

    if (matchLevel === "email" || matchLevel === "qq" || matchLevel === "name") matchCount++;

    // 该编辑是否出现在平台最新动态中（精确命中）
    const editorMentioned =
      (email && newEmails.has(email)) ||
      (qq && newQqs.has(qq)) ||
      (name && newEditors.has(name));

    // 变化判断：
    // 精确匹配(姓名/邮箱/QQ)或编辑被提及 → 判定个体变化
    // 否则仅记录平台级状态，不将平台整体变化套用到每个编辑
    const isPrecise = matchLevel === "email" || matchLevel === "qq" || matchLevel === "name";
    const oldDirections = (editor.workTypes || []).map((d) => d.trim()).filter(Boolean);
    const newDirs = isPrecise ? [...newDirections] : [];
    const directionChanged = isPrecise && newDirs.length > 0 && JSON.stringify([...oldDirections].sort()) !== JSON.stringify([...newDirs].sort());

    const oldStatus = editor.status || "";
    const statusChanged = isPrecise && newStatus && newStatus !== oldStatus;

    output.push({
      id: editor.id,
      name: editor.name,
      platform: editor.platform,
      oldStatus: oldStatus,
      newStatus: isPrecise ? newStatus || oldStatus : oldStatus,
      statusChanged,
      oldDirections: oldDirections,
      newDirections: newDirs,
      directionChanged,
      email: editor.email || "",
      qq: editor.qq || "",
      matchLevel,
      editorMentioned,
      platformActive,
      verified: prs.length > 0,
    });
  }

  return { items: output, matchCount, platformOnlyCount, total: editors.length };
}

/**
 * 生成统计摘要
 */
function buildReport(compareResult) {
  const items = compareResult.items;
  const stats = {
    total: items.length,
    verified: items.filter((i) => i.verified).length,
    unverified: items.filter((i) => !i.verified).length,
    statusChanged: items.filter((i) => i.statusChanged).length,
    directionChanged: items.filter((i) => i.directionChanged).length,
    anyChanged: items.filter((i) => i.statusChanged || i.directionChanged).length,
    editorMatched: items.filter((i) => i.matchLevel !== "platform" && i.matchLevel !== "none").length,
    platformMatched: items.filter((i) => i.matchLevel === "platform").length,
    notMatched: items.filter((i) => i.matchLevel === "none").length,
  };
  return {
    generatedAt: new Date().toLocaleString(),
    stats,
    changedItems: items.filter((i) => i.statusChanged || i.directionChanged),
    verifiedItems: items.filter((i) => i.verified),
    all: items,
  };
}

module.exports = { compareEditors, buildReport, normalize };
