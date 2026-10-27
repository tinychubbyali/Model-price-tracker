# Model Price Tracker 大模型价格追踪

自动记录主流大模型 API 牌价及其历史变动的静态网站。

- **覆盖厂商**：OpenAI、Anthropic、Google Gemini、DeepSeek、阿里云百炼（Qwen）、xAI、Mistral、智谱、Moonshot
- **价格口径**：标准按量计费，单位为每百万 tokens（USD），页面可切换为人民币显示
- **更新频率**：GitHub Actions 每天 02:00 UTC 抓取一次，价格有变动才会写入历史

## 工作原理

1. `scripts/fetch-prices.mjs` 拉取 [LiteLLM 价格数据集](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)。这是一份社区维护、对照各厂商官方价格页更新的机器可读价目表，每个模型都附有官方来源链接。
2. 脚本只保留各厂商直连 API 的对话模型（去掉 Azure/Bedrock 等转售渠道、微调模型和带日期的快照别名），换算成每百万 tokens 价格。
3. 与 `docs/data/prices.json` 中已有数据对比：价格变动、新上线、下架都会记入 `docs/data/changes.json`，并追加到对应模型的 `history`。
4. 如果某家厂商的模型数量骤降一半以上，脚本会报错退出、不写入数据，避免把抓取故障记成"下架"。
5. `docs/` 是纯静态网站，由 GitHub Pages 直接发布，没有构建步骤。

## 本地运行

需要 Node.js 20 及以上，无需安装依赖。

```bash
npm test          # 运行单元测试
npm run fetch     # 抓取最新价格并更新 docs/data
npm run serve     # 本地预览网站
```

## 部署

仓库 Settings → Pages → Source 选择 "Deploy from a branch"，分支 `main`，目录 `/docs`。
