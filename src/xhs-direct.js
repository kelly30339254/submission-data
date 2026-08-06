/**
 * 小红书免费数据源模块（无需 token、无需登录）
 *
 * 实现原理：
 *   - 小红书 explore 首页的 SSR 初始状态（window.__INITIAL_STATE__）包含推荐流笔记数据，
 *     可通过纯 HTTP 获取（无需登录、无需签名）
 *   - 笔记详情页 /explore/{id}?xsec_token={token} 同样可通过 HTTP 获取完整正文
 *
 * 注意：explore 是"推荐流"而非关键词搜索。搜索接口需要登录态（-101），
 * 因此本模块采用"推荐流 + 关键词过滤 + 详情页深挖"策略，
 * 再配合 websearch 模块（Bing）补充关键词命中的网页约稿信息。
 */

const https = require("https");
const { stripHtml } = require("./websearch");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "zh-CN,zh;q=0.9",
          Referer: "https://www.xiaohongshu.com/",
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(body);
        });
      }
    );
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error("超时"));
    });
    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 提取 __INITIAL_STATE__
 */
function parseInitialState(html) {
  const m = html.match(/<script>window\.__INITIAL_STATE__\s*=\s*({.*?})<\/script>/);
  if (!m) return null;
  try {
    const raw = m[1].replace(/:undefined/g, ":null");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * 抓取 explore 推荐流
 * @param {number} page 翻页（通过 cursorScore）
 * @returns {Promise<Array>} 笔记列表
 */
async function fetchExplore(page = 0) {
  const url = page > 0 ? `https://www.xiaohongshu.com/explore?page=${page}` : "https://www.xiaohongshu.com/explore";
  const html = await httpGet(url);
  const state = parseInitialState(html);
  if (!state || !state.feed || !Array.isArray(state.feed.feeds)) {
    return { items: [], cursor: "" };
  }
  const feeds = state.feed.feeds;
  const items = [];
  for (const f of feeds) {
    if (f.modelType !== "note" || !f.noteCard) continue;
    const card = f.noteCard;
    const id = f.id;
    const xsecToken = card.user && card.user.xsecToken ? card.user.xsecToken : "";
    const author = card.user ? card.user.nickname : "";
    items.push({
      source: "xiaohongshu",
      title: card.displayTitle || "",
      author,
      id,
      xsecToken,
      url: id
        ? `https://www.xiaohongshu.com/explore/${id}?xsec_token=${encodeURIComponent(xsecToken)}`
        : "",
      likes: card.interactInfo ? card.interactInfo.likedCount : "",
      cover: card.cover && card.cover.infoList ? card.cover.infoList.map((i) => i.url) : [],
      type: card.type || "note",
    });
  }
  return {
    items,
    cursor: state.feed.query ? state.feed.query.cursorScore : "",
  };
}

/**
 * 抓取笔记详情
 * @param {object} item {id, xsecToken}
 * @returns {Promise<object>} 详情
 */
async function fetchNoteDetail(item) {
  if (!item.id || !item.xsecToken) return null;
  const url = `https://www.xiaohongshu.com/explore/${item.id}?xsec_token=${encodeURIComponent(item.xsecToken)}&xsec_source=pc_feed`;
  const html = await httpGet(url, 15000);
  const state = parseInitialState(html);
  if (!state || !state.note || !state.note.noteDetailMap) return null;
  const ids = Object.keys(state.note.noteDetailMap);
  if (!ids.length) return null;
  const detail = state.note.noteDetailMap[ids[0]].note;
  return {
    title: detail.title || "",
    desc: detail.desc || "",
    type: detail.type || "",
    author: detail.user ? detail.user.nickname : "",
    authorId: detail.user ? detail.user.userId : "",
    images: detail.imageList ? detail.imageList.map((i) => i.urlDefault || "") : [],
    time: detail.time ? new Date(detail.time * 1000).toISOString() : "",
    interact: detail.interactInfo || null,
  };
}

/**
 * 综合抓取：推荐流 + 详情页
 * @param {object} opts {keywordFilter, maxNotes, maxDetail, pages}
 */
async function crawlXHS(opts = {}) {
  const { keywordFilter = [], maxNotes = 50, maxDetail = 15, pages = 1 } = opts;
  const collected = [];
  const seenIds = new Set();

  for (let p = 0; p < pages; p++) {
    let result;
    try {
      result = await fetchExplore(p);
    } catch (e) {
      console.error(`[小红书] explore 抓取失败(page=${p}): ${e.message}`);
      break;
    }
    for (const item of result.items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      collected.push(item);
      if (collected.length >= maxNotes) break;
    }
    if (collected.length >= maxNotes) break;
    await sleep(800);
  }

  // 关键词过滤优先
  const filtered = keywordFilter.length
    ? collected.filter((i) => keywordFilter.some((kw) => i.title.includes(kw) || i.author.includes(kw)))
    : collected;

  // 对过滤结果抓详情
  const detailed = [];
  const target = filtered.length ? filtered : collected.slice(0, maxDetail);
  for (let i = 0; i < target.length && detailed.length < maxDetail; i++) {
    try {
      const d = await fetchNoteDetail(target[i]);
      if (d) {
        detailed.push({ ...target[i], detail: d });
        console.log(`[小红书] 详情成功: ${(d.title || "").slice(0, 30)}`);
      }
    } catch (e) {
      // 详情失败忽略
    }
    await sleep(500);
  }

  return {
    feed: collected,
    matched: filtered,
    details: detailed,
  };
}

module.exports = { crawlXHS, fetchExplore, fetchNoteDetail, parseInitialState, httpGet };
