# GitHub 部署指南（每日自动更新收稿数据）

本爬虫项目已配置 GitHub Actions 每日自动运行，生成 `editors-latest.json` 供软件客户端同步。

## 一键部署步骤

### 1. 创建 GitHub 仓库并推送

```bash
# 在 GitHub 网页创建新仓库（Public 公开仓库，数据才能被客户端免费读取）
# 仓库名建议: submission-data

cd c:\Users\20440\Desktop\爬虫

git init
git add .
git commit -m "init: 收稿数据爬虫与每日自动更新"
git branch -M main
git remote add origin https://github.com/<你的用户名>/submission-data.git
git push -u origin main
```

### 2. 启用 Actions

推送后 GitHub 会自动识别 `.github/workflows/monitor.yml`：
- 每天 **UTC 18:00（北京时间凌晨 2:00）** 自动运行
- 也可在仓库 **Actions 页面手动触发**（Workflow dispatch）

### 3. 验证

首次运行后，仓库 `main` 分支根目录会出现 `editors-latest.json`。

客户端下载地址（软件内配置）：
```
https://raw.githubusercontent.com/<你的用户名>/submission-data/main/editors-latest.json
```

## 工作原理

```
每天 02:00 (北京时间)
    ↓
GitHub Actions (ubuntu)
    ↓
node src/monitor-main.js      # 搜狗微信搜索各平台收稿动态
    ↓
node src/build-editors.js     # 整合生成 editors-latest.json
    ↓
自动提交并推送至 main 分支
    ↓
客户端点击"同步最新编辑"按钮
    ↓
下载 raw.githubusercontent.com/.../editors-latest.json
    ↓
更新本地编辑列表（含收稿方向列）
```

## 注意事项

1. **必须公开仓库**：客户端匿名下载需要 Public 仓库（GitHub 免费支持）
2. **搜狗风控**：Actions 每天只运行一次，频率低，一般不会触发验证码；若触发，工作流会记录风控平台数并继续
3. **手动更新**：Actions 页面点 "Run workflow" 可随时手动触发
4. **本地预览**：`npm run daily` 可本地跑完整流程
