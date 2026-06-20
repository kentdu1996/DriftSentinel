# Roadmap / 后续待办

> 状态基线:8 包构建 + 类型检查通过;核心引擎与路由层单测全绿;离线双节点场景 PASS;真实 Hub(validate-only)双节点场景 PASS。

## 优先级总览

| 优先级 | 事项 | 类型 | 是否消耗额度 |
|---|---|---|---|
| P0 | 真实 publish 端到端跑通并坐实 asset_id | 验证 | 是 |
| P0 | 建立 git 仓库并首次发布到 GitHub | 工程 | 否 |
| P1 | 真实 LLM 端点接入回归(非 mock) | 验证 | 是 |
| P1 | 进化时间线接真实数据联调 | 验证 | 否 |
| P1 | 群体公评跨多节点实测 | 验证 | 是 |
| P2 | 评测维度扩展(math/instruct/fact/longctx) | 产品 | 否 |
| P2 | 节点声誉与共识权重模型 | 产品 | 否 |
| P2 | CI / 一键 Demo 录制脚本 | 工程 | 否 |

---

## P0:发布前必须做

### 1. 真实 publish 端到端
- 操作:`SWARM_REMOTE=1 DRIFT_PUBLISH=1` + 真实 `config.evomap.yaml`(需配 `EVOMAP_API_KEY`)。
- 验证点:`/a2a/publish` 返回真实 `asset_id`;在 EvoMap 上可检索到该 Gene/Capsule;Node B 能 `fetch` 到并继承。
- 注意:消耗额度且链上资产不可回收,确认后再跑;跑通后把真实 asset_id 截图留作路演证据。

### 2. 建 GitHub 仓库
- 设备恢复后,把本发布包(README/LICENSE/.gitignore/CONTRIBUTING/ROADMAP + docs/assets)与 `packages/` 源码合并到项目根。
- 检查 `.secrets/` 已被忽略、`data/*.db` 不入库。
- `git init && git add . && git commit && git push`,见 PUBLISH_GUIDE.md。

---

## P1:发布后尽快做

### 3. 真实 LLM 端点回归
- 当前场景默认走 mock 端点。需用真实模型/中转站端点跑一轮检测,确认基线、漂移判定、自愈路由在真实噪声下稳定。
- 验证点:正常端点不误报;人为切弱模型后能在 1–2 个周期内判 confirmed。

### 4. 进化时间线真实数据联调
- 后端 `/api/timeline` 已合并 GEP 周期 / 资产 / 节点结论。需用真实运行数据验证 SSE(vote/report/memory)实时刷新、四类事件配色正确、时间序无错乱。

### 5. 群体公评多节点实测
- 目前双节点验证 L2 共识。需 ≥3 节点验证 vote/report 汇聚、可信度随节点数上升、冲突场景(部分节点判 normal)的处理。

---

## P2:增强方向

### 6. 评测维度扩展
- 现以 code 维度为主。补 math / instruct / fact / longctx 题集与对应 grader,让降智信号更全面。

### 7. 节点声誉与共识权重
- 引入节点历史准确率作为共识权重,降低恶意/低质节点影响,提升公评网络抗污染能力。

### 8. CI 与一键 Demo
- 加 GitHub Actions:build + typecheck + test + 离线场景冒烟。
- 写一键脚本:启动服务 → 注入降智 → 录制 Dashboard 自愈与继承全过程,产出路演视频。

---

## 已知约束(发布须知)

- 场景脚本必须在仓库根目录运行,否则读不到 `testsets/`,分数恒为 0。
- `config.demo.yaml` 为离线 mock,`config.evomap.yaml` 需真实 Key。
- 真实发布不可回收,不要在自动化里默认开启 `DRIFT_PUBLISH=1`。
- 判定算法 / 数据结构 / asset_id 计算保持稳定,变更需单独评估。
