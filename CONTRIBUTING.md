# CONTRIBUTING.md

本项目贡献指南，适用于所有开发者（人类和 AI）。

## 版本号规范

遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：

```
v{MAJOR}.{MINOR}.{PATCH}

MAJOR — 不兼容的架构变更
MINOR — 向后兼容的新功能
PATCH — 向后兼容的 Bug 修复
```

当前版本：`v2.0.0`

## Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
<type>: <description>

<body>
```

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（无功能变化） |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 构建/工具/依赖 |
| `perf` | 性能优化 |

## Changelog 规范

### 规则

- 每次 feature / fix / refactor 都必须生成对应的 changelog
- 文件放在 `changelogs/` 目录下
- 命名格式：`v{MAJOR}.{MINOR}.{PATCH}-{slug}.md`
  - 示例：`v1.2.1-fix-complaint-misclassification.md`

### 文件模板

```markdown
# vX.Y.Z — 简短摘要

**日期**: YYYY-MM-DD

**问题/背景**: （fix 写问题，feature 写需求）

---

## 改动明细

### 1. `path/to/file` — 改动说明 (line 行号)

**原因**: 为什么改

```code
// before → after 对比
```

### 2. `path/to/file2` — 改动说明 (line 行号)

...

---

## 影响范围

| 场景 | 预期 | 实际 | 状态 |
|------|------|------|------|
| Case 1 | ... | ... | OK / 修复 |
```

### 必须包含

- [ ] 版本号、日期、一句话摘要
- [ ] 问题描述或需求背景
- [ ] 每个修改文件的路径和行号
- [ ] 关键代码变动（before/after 或 diff）
- [ ] 踩坑记录（如方案有回退或反复）
- [ ] 影响范围验证表格

### 参考范例

`changelogs/v1.2.1-fix-complaint-misclassification.md`
