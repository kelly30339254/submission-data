/**
 * 网页搜索数据源模块
 * 基于 Bing 搜索结果页抓取公开信息（无需登录、无 API key）
 * 用于补充小红书之外的中文互联网收稿信息
 */

const https = require("https");
const http = require("http");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpGet(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      res.setEncoding("utf-8");
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        // 允许 200/202 及部分反爬状态返回的内容；其它视为失败
        const ok = res.statusCode === 200 || res.statusCode === 202;
        if (!ok) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        resolve(body);
      });
    });
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`超时: ${url}`));
    });
    req.on("error", reject);
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 抓取 Bing 搜索结果
 * @param {string} query
 * @param {number} count 结果数量
 */
async function bingSearch(query, count = 10) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}&mkt=zh-CN`;
  const html = await httpGet(url);
  const results = [];
  // 解析 li.b_algo 结果块
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  for (const block of blocks) {
    if (results.length >= count) break;
    const linkMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>/);
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    // 摘要：取结果块内 <p> 或通用容器文本
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const captionMatch = block.match(/class="b_caption"[\s\S]*?>([\s\S]*?)<\/div>/);
    if (!linkMatch || !titleMatch) continue;
    const link = linkMatch[1];
    const title = stripHtml(titleMatch[1]);
    let snippet = pMatch ? stripHtml(pMatch[1]) : "";
    if (!snippet && captionMatch) snippet = stripHtml(captionMatch[1]);
    if (!/bing\.com|microsoft|msn\.com/i.test(link)) {
      results.push({ title, link, snippet, source: "web" });
    }
  }
  return results;
}

/**
 * 抓取网页正文并清洗
 * @param {string} url
 */
async function fetchPageText(url) {
  const html = await httpGet(url);
  // 提取 title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : "";
  const text = stripHtml(html);
  return { url, title, text: text.slice(0, 12000) };
}

/**
 * 搜狗微信搜索（公众号文章，收稿/约稿信息的主要载体）
 * 无需登录；可识别验证码风控
 * @param {string} query
 * @param {number} count
 * @returns {Promise<Array>} results 带 blocked 标记
 */
async function sogouWeixinSearch(query, count = 10) {
  const url = "https://weixin.sogou.com/weixin?type=2&query=" + encodeURIComponent(query);
  const html = await httpGet(url, 15000);

  // 验证码/风控检测
  const blocked =
    /VerifyCode|验证码|antispider|seccodeRight|此验证码用于确认/.test(html) ||
    html.length < 8000;

  const results = [];
  // 结果项结构：<li id="sogou_vr_11002601_box_0">... <h3><a href>标题</a></h3> ... 公众号名 <p class="txt-info">摘要</p> ...
  const itemRegex =
    /<li id="sogou_vr_11002601_box_(\d+)"[\s\S]*?<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>[\s\S]*?<div class="s-p">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/div>[\s\S]*?<p[^>]*class="txt-info"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  const seen = new Set();
  while ((m = itemRegex.exec(html)) !== null) {
    const link = "https://weixin.sogou.com" + m[2];
    const title = stripHtml(m[3]).replace(/\s+/g, " ").trim();
    const account = stripHtml(m[4]).replace(/\s+/g, " ").trim();
    const snippet = stripHtml(m[5])
      .replace(/&mdash;/g, "-")
      .replace(/&zwj;/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = title;
    if (!seen.has(key) && title.length > 4) {
      seen.add(key);
      results.push({ title, link, snippet, account, source: "sogou" });
    }
    if (results.length >= count) break;
  }
  // 回退：宽松匹配（无公众号名时）
  if (results.length === 0) {
    const fallback = /<a[^>]*href="(\/link\?url=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let f;
    while ((f = fallback.exec(html)) !== null && results.length < count) {
      const link = "https://weixin.sogou.com" + f[1];
      const title = stripHtml(f[2]).replace(/\s+/g, " ").trim();
      if (title.length > 4 && !seen.has(title)) {
        seen.add(title);
        results.push({ title, link, snippet: "", account: "", source: "sogou" });
      }
    }
  }
  results.blocked = blocked;
  return results;
}

module.exports = { bingSearch, sogouWeixinSearch, fetchPageText, httpGet, stripHtml };
