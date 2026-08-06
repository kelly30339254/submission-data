/**
 * 小红书数据源模块
 * 基于 GuaiKei 小红书公开数据 API（无需登录）
 * 需要环境变量 GUAIKEI_API_TOKEN（32位）
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");

const BASE_URL = "www.guaikei.com";
const REQUEST_TIMEOUT = 20000;

/**
 * 获取 token：优先环境变量，其次项目内 config/token.js 或 .env
 */
function loadToken() {
  if (process.env.GUAIKEI_API_TOKEN) return process.env.GUAIKEI_API_TOKEN.trim();
  const root = path.resolve(__dirname, "..");
  // .env 文件
  try {
    const envFile = path.join(root, ".env");
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, "utf-8");
      const m = content.match(/^GUAIKEI_API_TOKEN\s*=\s*(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch (e) { /* ignore */ }
  // config/token.js
  try {
    const tokenFile = path.join(root, "config", "token.js");
    if (fs.existsSync(tokenFile)) {
      const mod = require(tokenFile);
      if (typeof mod === "string") return mod.trim();
      if (mod && mod.GUAIKEI_API_TOKEN) return String(mod.GUAIKEI_API_TOKEN).trim();
    }
  } catch (e) { /* ignore */ }
  return "";
}

/**
 * 基础请求封装
 */
function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, timeout: REQUEST_TIMEOUT }, (res) => {
      res.setEncoding("utf-8");
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(body);
            if (json.errcode === 0) {
              resolve(json);
            } else {
              reject(new Error(json.errmsg || "请求失败"));
            }
          } catch (e) {
            reject(new Error(`响应解析失败: ${e.message}`));
          }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error("GUAIKEI_API_TOKEN 无效，请检查环境变量"));
        } else {
          reject(new Error(`请求失败, 状态码: ${res.statusCode}`));
        }
      });
    });
    req.on("error", (err) => reject(new Error(`网络错误: ${err.message}`)));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("请求超时"));
    });
    if (data) req.write(data);
    req.end();
  });
}

function postJson(path, params, data) {
  const fullPath = `${path}?${querystring.stringify(params)}`;
  const jsonData = JSON.stringify(data);
  return request(
    {
      host: BASE_URL,
      path: fullPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(jsonData),
      },
    },
    jsonData
  );
}

function getJson(path, params) {
  params._ = Date.now();
  const fullPath = `${path}?${querystring.stringify(params)}`;
  return request({
    host: BASE_URL,
    path: fullPath,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 校验 token
 */
function isValidToken(token) {
  return !!token && typeof token === "string" && /^[0-9a-zA-Z]{32}$/.test(token);
}

/**
 * 创建搜索任务并等待结果
 * @param {string} keyword
 * @param {object} opts {type, sort, time, limit}
 */
async function searchNotes(keyword, opts = {}) {
  const { type = 0, sort = 0, time = 0, limit = 20 } = opts;
  const token = loadToken();
  if (!isValidToken(token)) {
    throw new Error(
      "GUAIKEI_API_TOKEN 未配置或格式不正确（需32位），请先设置环境变量、.env 或 config/token.js 后重试。"
    );
  }

  // 1. 创建任务
  let err = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await postJson(
        "/api/xiaohongshu/note-search/keyword",
        { _: Date.now(), token },
        { keyword, type, sort, time, limit }
      );
      err = null;
      break;
    } catch (e) {
      err = e;
      await sleep(2000);
    }
  }
  if (err) throw err;

  // 2. 轮询结果
  let result = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(2000);
    try {
      const res = await getJson("/api/xiaohongshu/note-search/info", {
        token,
        keyword,
        type,
        sort,
        time,
        limit,
      });
      if (res.errcode === 0 && Array.isArray(res.data)) {
        result = res.data.map((item) => {
          if (item.id && item.xsec_token) {
            item.url =
              "https://www.xiaohongshu.com/explore/" +
              item.id +
              "?xsec_token=" +
              item.xsec_token;
          }
          if (item.user && item.user.user_id && item.user.xsec_token) {
            item.user.url =
              "https://www.xiaohongshu.com/user/profile/" +
              item.user.user_id +
              "?xsec_token=" +
              item.user.xsec_token;
          }
          return item;
        });
        break;
      }
    } catch (e) {
      err = e;
    }
  }
  if (!result) {
    if (err) throw err;
    throw new Error("搜索任务未返回结果，请稍后重试");
  }
  return result;
}

module.exports = { searchNotes, isValidToken, loadToken };
