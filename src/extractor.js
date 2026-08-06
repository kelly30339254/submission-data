/**
 * 信息提取器
 * 从笔记/网页文本中提取：编辑、邮箱、平台、收稿方向、联系方式
 */

const {
  PLATFORMS,
  DIRECTIONS,
  EDITOR_PATTERNS,
  EMAIL_PATTERN,
  WECHAT_PATTERNS,
  PLATFORM_SUFFIX,
} = require("../config/keywords");

// 额外的编辑识别模式（针对搜狗摘要/约稿函文本）
const EXTRA_EDITOR_PATTERNS = [
  // 编辑XX 或 XX编辑/编辑：XX
  /(?:编辑|小编)[：:\s]*([\u4e00-\u9fa5A-Za-z0-9_]{2,8})/g,
  // 我是编辑XX / 我是XX
  /(?:我是|我是编辑)([\u4e00-\u9fa5A-Za-z0-9_]{2,8})/g,
  // 联系编辑XX
  /(?:联系|对接|对接编辑|私信编辑)[：:\s]*([\u4e00-\u9fa5A-Za-z0-9_]{2,8})/g,
];

function unique(arr) {
  return [...new Set(arr.filter(Boolean).map((s) => s.trim()).filter((s) => s.length > 0))];
}

/**
 * 提取邮箱
 */
function extractEmails(text) {
  if (!text) return [];
  return unique(
    (text.match(EMAIL_PATTERN) || [])
      // 清理常见噪音后缀
      .map((e) => e.replace(/END$/i, ""))
      .filter((e) => e.length <= 50)
  );
}

/**
 * 提取微信号
 */
function extractWechats(text) {
  if (!text) return [];
  const found = [];
  for (const pat of WECHAT_PATTERNS) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      found.push(m[1]);
    }
  }
  return unique(found);
}

/**
 * 提取编辑姓名/昵称
 */
function extractEditors(text) {
  if (!text) return [];
  const found = [];
  const allPatterns = [...EDITOR_PATTERNS, ...EXTRA_EDITOR_PATTERNS];
  for (const pat of allPatterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const name = m[1];
      // 过滤明显非人名的词
      if (
        name &&
        !/^(编辑|老师|投稿|收稿|邮箱|联系|微信|QQ|私信|后台|我们|我|你|他|她)$/.test(name) &&
        name.length >= 2 &&
        name.length <= 8 &&
        // 排除包含非人名特征的词（网/官/器/平台/部/站/号等）
        !/(网|官|器|平台|部|站|号|工具|官网|图文|H5|公众号|账号|类型|要求|题材|故事|小说|千字|篇|男频|女频|言情|悬疑)/.test(name) &&
        // 排除纯数字或"数字+"开头（如QQ号片段）
        !/^\d{3,}/.test(name)
      ) {
        found.push(name);
      }
    }
  }
  return unique(found);
}

/**
 * 识别平台
 * strong 平台：出现即计入
 * weak 平台：需要伴随收稿/投稿/约稿等上下文才计入
 */
function extractPlatforms(text, fallbackPlatform) {
  const found = new Set();
  if (fallbackPlatform) found.add(fallbackPlatform);
  if (!text) return [...found];
  const ctx = /(收稿|约稿|征稿|投稿|征集|求稿|收稿中|长期收|接收稿|编辑|邮箱|投稿邮箱|稿费|字数)/;
  for (const p of PLATFORMS.strong) {
    if (text.includes(p)) found.add(p);
  }
  for (const p of PLATFORMS.weak) {
    if (text.includes(p) && ctx.test(text)) found.add(p);
  }
  return [...found];
}

/**
 * 识别收稿方向
 */
function extractDirections(text) {
  if (!text) return [];
  const matched = [];
  for (const [dir, keywords] of Object.entries(DIRECTIONS)) {
    if (keywords.some((k) => text.includes(k))) {
      matched.push(dir);
    }
  }
  return matched;
}

/**
 * 判断是否为收稿/约稿类内容
 */
function isSubmissionContent(text, title) {
  const all = `${title || ""} ${text || ""}`;
  const hit = /(收稿|约稿|征稿|投稿|征集|求稿|收稿中|长期收|接收稿|邮箱|编辑)/.test(all);
  return hit;
}

/**
 * 从单条笔记对象提取结构化信息
 * @param {object} item 小红书笔记或网页结果
 * @param {object} opts {source, fallbackPlatform}
 */
function extractFromItem(item, opts = {}) {
  const { source = "xiaohongshu", fallbackPlatform = "" } = opts;
  const title = item.title || item.noteTitle || "";
  const desc = item.desc || item.content || item.snippet || "";
  const pageText = item.pageText || "";
  const author = item.author || (item.user && item.user.nickname) || "";
  // 合并文本：标题 + 描述 + 详情页正文
  const text = `${title} ${desc} ${pageText}`;

  const info = {
    source, // 数据来源: xiaohongshu / web
    title,
    desc,
    author,
    authorUrl: item.user?.url || item.authorUrl || "",
    url: item.url || item.link || "",
    // 提取字段
    editors: extractEditors(text),
    emails: extractEmails(text),
    wechats: extractWechats(text),
    platforms: extractPlatforms(text, fallbackPlatform),
    directions: extractDirections(text),
    // 互动数据（小红书）
    likes: item.liked_count ?? item.likeCount ?? null,
    collects: item.collected_count ?? item.collectCount ?? null,
    comments: item.commented_count ?? item.commentCount ?? null,
    publishTime: item.published_at || item.publishTime || item.pub_time || "",
    isSubmission: isSubmissionContent(text, title),
  };
  return info;
}

/**
 * 主入口：批量提取
 */
function extractItems(items, opts = {}) {
  return items.map((item) => extractFromItem(item, opts)).filter((i) => i.title || i.desc);
}

module.exports = {
  extractItems,
  extractFromItem,
  extractEmails,
  extractEditors,
  extractPlatforms,
  extractDirections,
  extractWechats,
  isSubmissionContent,
  unique,
};
