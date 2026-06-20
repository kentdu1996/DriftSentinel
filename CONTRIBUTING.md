# 贡献指南

感谢你对 DriftSentinel 的关注。模型质量治理需要尽可能多的节点参与——你的每一次探测、每一条经验,都会让这张公共质量网络更可信。

## 开发环境

- Node.js >= 20
- pnpm(workspace)

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

## 本地验证

```bash
# 离线双节点协作场景(不消耗额度),必须在仓库根目录运行
npx tsx packages/router/src/swarm-scenario.ts config.demo.yaml
```

## 提交规范

- 一个 PR 聚焦一件事,描述清楚动机与验证方式。
- 改动需通过 `pnpm -r build`、`pnpm -r typecheck`、`pnpm -r test`。
- 不要改动判定算法、数据结构、asset_id 计算,除非 PR 专门讨论该变更。

## 安全红线

- **不要提交** `.secrets/`、API Key、Bearer Token、任何凭据。
- 发布到 EvoMap 的内容必须经过脱敏发布闸;不要绕过 sanitize。
- 真实发布(`DRIFT_PUBLISH=1`)会消耗额度且链上资产不可回收,请勿在 CI / 测试里默认开启。

## 方向建议

欢迎在这些方向贡献:

- 新增评测维度(math / instruct / fact / longctx)的题集与 grader;
- 更多模型 / 中转站平台的 adapter;
- 共识聚合策略与节点声誉模型的改进;
- Dashboard 可视化与交互优化。
