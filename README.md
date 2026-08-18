# 短篇小说收稿信息爬虫

自动搜索并整理 **短篇小说收稿** 相关的 **编辑、邮箱、平台、收稿方向** 信息。

## 数据源（三通道，全部免费可用）

| 通道 | 说明 | 是否需要登录/Token |
| --- | --- | --- |
| **搜狗微信搜索** | 公众号约稿函（收稿邮箱/编辑信息的核心来源） | ❌ 无需 |
| **小红书（免费通道）** | explore 推荐流 + 笔记详情页深挖 | ❌ 无需 |
| **小红书（精确通道）** | GuaiKei 搜索 API（精确关键词搜索） | 需 Token（可选） |
| **Bing 网页搜索** | 通用网页约稿信息补充 | ❌ 无需 |

> 说明：小红书搜索接口需要登录态，免费通道通过「推荐流 + 关键词过滤 + 详情页深挖」提取信息；
> 搜狗微信搜索是公众号约稿函（含编辑+邮箱）的最高效免费来源。

## 功能特性

- 多关键词批量搜索（覆盖"收稿/约稿/征稿/投稿"等多角度）
- 自动提取结构化字段：
  - `editors` 收稿编辑（姓名/昵称）
  - `emails` 投稿邮箱
  - `wechats` 微信号
  - `platforms` 收稿平台
  - `directions` 收稿方向（言情/悬疑/科幻/奇幻等）
- 按平台、方向自动汇总统计
- 结果去重，导出 **JSON / CSV / Excel**（UTF-8 BOM，Excel 直接打开不乱码）

## 环境要求

- Node.js >= 16.14（零第三方依赖，可选安装 puppeteer-core 增强）

## 使用

```bash
# 全量搜索（小红书免费通道 + 搜狗微信 + Bing）
node src/main.js

# 严格模式（只保留含收稿/邮箱/编辑/微信号的结果，推荐）
node src/main.js --strict

# 仅网页通道（搜狗微信 + Bing）
node src/main.js --web-only

# 仅小红书（免费推荐流通道）
node src/main.js --xhs-only

# 自定义参数
node src/main.js --limit 20 --pages 3 --max-detail 15 --output ./output
```

## 输出说明

运行后在 `output/` 目录生成：

| 文件 | 说明 |
| --- | --- |
| `submission_日期.json` | 完整结构化数据 + 统计摘要 |
| `submission_日期.csv` | 表格数据（Excel 可直接打开） |
| `submission_日期.xls` | Excel 表格 |

## 可选：小红书精确搜索（Token）

如需通过小红书 API 精确搜索关键词（而非推荐流过滤），可在项目根目录 `.env` 中配置
`GUAIKEI_API_TOKEN`（32位，前往 [guaikei.com](https://www.guaikei.com) 获取）。
配置后运行将自动改用精确搜索通道，可搜到更多含编辑/邮箱的收稿笔记。

## 编辑收稿信息核实工具

核对 `submission-editors.json`（2979 名有效编辑）的收稿方向/状态是否更新：

```bash
# 全量核实（1039 个平台，约 20-40 分钟）
node src/verify-main.js

# 仅核实编辑数 TOP 20 的平台（快速验证）
node src/verify-main.js --platforms 20

# 只导出有变化的精简报告
node src/verify-main.js --status-only

# 生成 markdown 摘要报告
node src/report.js
```

工作原理：按平台聚合 → 搜狗微信搜索"平台名+收稿/约稿"获取公众号最新约稿函 →
提取编辑名/邮箱/QQ/收稿方向/状态 → 与旧数据匹配对比。

输出在 `verify-out/` 目录：`verify_日期.json`（完整）、`.csv`/`.xls`（表格）、`.md`（摘要）。
核实过程支持断点续传（`progress.json`），中断后重新运行可继续。

## 公众号收稿动态监测工具

按平台自动监测公众号收稿动态，检测更新（新动态/方向变化/状态变化/新编辑）：

```bash
# 监测全部平台（1039 个，约 40-80 分钟）
npm run monitor

# 监测编辑数 TOP 50 平台（约 5-10 分钟）
npm run monitor:top

# 监测指定平台
node src/monitor-main.js --platforms 七猫,四季文学

# 自定义参数（批次/间隔/风控冷却）
node src/monitor-main.js --batch 2 --delay 2500 --retry-delay 60000
```

**工作原理**：按平台 → 搜狗微信搜索"平台名+收稿/约稿" → 提取公众号名、编辑、邮箱、QQ、
收稿方向、状态 → 保存每日快照 → 与上次快照对比，检测更新。

**输出**（`monitor-out/` 目录）：
- `monitor_日期.md` — 更新摘要报告（状态/方向变化、新动态、疑似停止）
- `monitor_日期_updates.csv` — 更新明细
- `monitor_日期_platforms.csv` — 全平台快照
- `snapshot_日期.json` — 数据快照（用于下次对比，保留最近 N 天）

**反爬处理**：自动检测搜狗验证码风控（`blocked` 标记），整批拦截时自动冷却等待；
建议间隔 ≥2.5s、每批 ≤2 个平台。首次运行建立快照，第二次运行起开始检测差异。

## 自定义配置

修改 `config/keywords.js` 可调整：

- `XHS_KEYWORDS` 小红书精确搜索关键词（需 token）
- `WEB_KEYWORDS` Bing 网页搜索关键词
- `SOGOU_KEYWORDS` 搜狗微信搜索关键词（约稿函）
- `PLATFORMS` 平台词库（`strong` 直接识别 / `weak` 需收稿上下文）
- `DIRECTIONS` 收稿方向分类词库
- `EDITOR_PATTERNS` 编辑姓名识别规则
- `EMAIL_PATTERN` 邮箱识别正则

## 项目结构

```
.
├── config/keywords.js    # 关键词与识别规则配置
├── src/
│   ├── main.js           # 主入口
│   ├── xiaohongshu.js    # 小红书 API 数据源（可选 token）
│   ├── xhs-direct.js     # 小红书免费数据源（推荐流+详情页）
│   ├── websearch.js      # 网页数据源（Bing + 搜狗微信）
│   ├── extractor.js      # 信息提取器
│   └── exporter.js       # 导出模块
├── .env.example          # Token 配置模板（可选）
└── output/               # 输出目录
```

## 合规说明

- 仅采集公开数据，不登录、不涉及私密内容
- 请合理控制请求频率，尊重目标平台 robots 规则
