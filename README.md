# Numagic-AIStudy

从 Token 价格切入，追踪 AI 产业链的宏观指标。（原名 Model Price Tracker 大模型价格追踪）

自动记录主流大模型 API 牌价及其历史变动的静态网站。

- **覆盖厂商**：OpenAI、Anthropic、Google Gemini、DeepSeek、阿里云百炼（Qwen）、xAI、Mistral、智谱、Moonshot
- **价格口径**：标准按量计费，单位为每百万 tokens（USD），页面可切换为人民币显示
- **更新频率**：GitHub Actions 每天 02:00 UTC 抓取一次，价格有变动才会写入历史

## 工作原理

1. `scripts/fetch-prices.mjs` 拉取 [LiteLLM 价格数据集](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)。这是一份社区维护、对照各厂商官方价格页更新的机器可读价目表，每个模型都附有官方来源链接。
2. 脚本只保留各厂商直连 API 的对话模型（去掉 Azure/Bedrock 等转售渠道、微调模型和带日期的快照别名），换算成每百万 tokens 价格。
3. 与 `docs/data/prices.json` 中已有数据对比：价格变动、新上线、下架都会记入 `docs/data/changes.json`，并追加到对应模型的 `history`。
4. 如果某家厂商的模型数量骤降一半以上，脚本会报错退出、不写入数据，避免把抓取故障记成"下架"。
5. `scripts/fetch-multimodal.mjs` 从同一份数据集取视频、图片、语音合成、语音识别、音乐的官方牌价，保留厂商原生单位，并换算成“标准成品价”（一条 5 秒 720p 视频、一张约 1K 图片、1 分钟语音、1 小时转写、一首歌），写入 `docs/data/multimodal.json`。没有公开 API 牌价的产品（Suno 订阅、3D 生成的积分制）在 `docs/data/multimodal-manual.json` 人工维护，页面上标为“估算”。
6. `scripts/build-weekly.mjs` 在每日抓取之后运行，生成 `docs/data/weekly.json`：每类模型每周一个点的「同款调价指数」（只比较同一个模型前后两周的价格，连乘，起点 = 100）和「在售价格中位数」，以及全部调价事件。
7. 每次检测到的调价会进入 `docs/data/review.json` 待复核清单（`status`：pending 待复核 / confirmed 已确认 / error 数据源错误；`announced` 填厂商公告日期，`link` 填公告链接）。疑似数据源录入错误的（同厂商同周 5 个以上模型改成同一价格、价格来回跳、单次变动 5 倍以上）标为「潜在异常」，复核确认前不计入指数。填了公告日期的调价按公告日期归周。`node scripts/review-digest.mjs` 打印当天的待复核清单。
8. 2025-11 至今的历史价格由 `scripts/backfill.mjs` 一次性回溯：取 LiteLLM 价目表在 GitHub 主线上每周最后一个版本，用同样的规则解析后接到实时数据前面（`prices.json` / `multimodal.json` 的 `backfill` 字段记录了范围）。社区数据源比厂商公告晚几天到一两周，所以回溯数据只按周展示。
9. `docs/` 是纯静态网站，由 GitHub Pages 直接发布，没有构建步骤。

## 本地运行

需要 Node.js 20 及以上，无需安装依赖。

```bash
npm test          # 运行单元测试
npm run fetch     # 抓取最新价格并更新 docs/data
npm run fetch-multimodal  # 抓取多模态价格
npm run serve     # 本地预览网站
```

## 部署

仓库 Settings → Pages → Source 选择 "Deploy from a branch"，分支 `main`，目录 `/docs`。
