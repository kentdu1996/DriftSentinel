# GitHub 发布操作指南

> 本发布包(release/)包含可直接放到 GitHub 的"外壳文件"与配图。设备恢复后,与项目源码 `packages/` 合并即可发布。

## 一、发布包内容

```
release/
├── README.md              # 项目主页(含配图引用)
├── LICENSE                # MIT
├── .gitignore             # 已排除 .secrets/ data/ node_modules 等
├── CONTRIBUTING.md        # 贡献指南
├── ROADMAP.md             # 路线图 / 后续待办
├── PUBLISH_GUIDE.md       # 本文件
└── docs/
    └── assets/            # 8 张高质量配图(README 与文档引用)
        ├── 01_hero.jpeg
        ├── 02_product_arch.jpeg
        ├── 03_tech_arch.jpeg
        ├── 04_pitch_keyvisual.jpeg
        ├── 05_gep_loop.jpeg
        ├── 06_dashboard.jpeg
        ├── 07_drift_detect.jpeg
        └── 08_business_value.jpeg
```

## 二、合并到项目

将 release/ 的文件复制到项目根目录 `DriftSentinel_docs 2/driftsentinel/`:

```bash
cd "/Users/bytedance/DriftSentinel_docs 2/driftsentinel"
# 复制外壳文件与配图(README/LICENSE/.gitignore/CONTRIBUTING/ROADMAP/PUBLISH_GUIDE + docs/assets)
# 注意:.gitignore 若已存在,先 review 再覆盖
```

## 三、发布前自查(重要)

```bash
# 确认敏感文件不会入库
git status --ignored | grep -E "\.secrets|\.db|node_modules"   # 应在 ignored 区
# 全量验证
pnpm install && pnpm -r build && pnpm -r typecheck && pnpm -r test
# 离线场景冒烟(根目录运行)
npx tsx packages/router/src/swarm-scenario.ts config.demo.yaml
```

- [ ] `.secrets/node.json` 不在待提交列表
- [ ] `data/*.db`、`genes.json` 等运行产物不入库
- [ ] README 配图能正常显示(docs/assets 路径正确)
- [ ] 内部文档(06–15 号 md)按需保留或移到 docs/,避免敏感信息外泄

## 四、初始化并推送

```bash
cd "/Users/bytedance/DriftSentinel_docs 2/driftsentinel"
git init
git add .
git commit -m "feat: DriftSentinel — Agent 降智检测与自愈公评网络"
git branch -M main
git remote add origin https://github.com/<your-account>/DriftSentinel.git
git push -u origin main
```

## 五、GitHub 仓库设置建议

- Description:`Agent 降智检测与自愈公评网络 — an immune system for the AI agent society`
- Topics:`a2a` `llm` `agent` `model-quality` `evomap` `observability` `ai-sre`
- 开启 Issues / Discussions,方便社区上报中转站降智案例。
- 首个 Release 打 tag `v0.1.0`,附 ROADMAP 中 P0/P1/P2 计划。

## 六、内部文档处理

项目里 06–15 号 md 属于内部交付资料,发布到公开仓库前请确认:
- 是否需要随仓库公开;
- 是否含真实姓名 / 邮箱 / 团队编号等,需要时移除或脱敏。
建议:公开仓库只保留 README/LICENSE/CONTRIBUTING/ROADMAP + docs/,内部交付文档单独存放。
