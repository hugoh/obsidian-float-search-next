# ADR-0002: 排除文件夹与文件（胶囊 UI，双层，双生效）

> **Note (consolidated version).** The rules below were tightened: a folder matches as a path prefix and a file only by its exact path (no extension or bare-name matching), and the injected query term is an anchored, escaped regex so native search and quick search agree. It is a convenience filter, not a privacy control. See [docs/consolidation.md](../consolidation.md).

- 状态：Accepted（已按合并版本修订）
- 日期：2026-07-07

## Context

用户希望排除一定文件夹与文件。排除项以**胶囊（pill）**形式呈现，点一下即删除；并分为两层：**排除文件夹**、**排除文件**。

## Decision

设置页新增两块胶囊输入：

- **排除文件夹**：每行/每个胶囊一个文件夹路径（如 `Templates/`、`_assets/`）。
- **排除文件**：每行/每个胶囊一个文件的完整路径（如 `Inbox/old.md`）。

胶囊交互：输入后回车 → 生成胶囊；点击胶囊 → 删除。

**双生效**：

- CMDK 极速框：过滤 `vault.getFiles()`，剔除命中排除项的文件（文件夹=路径前缀匹配；文件=精确路径匹配）。
- 主浮窗：打开/执行搜索时，把排除项自动拼成 Obsidian 排除运算符注入查询——文件夹用 `-path:/^<folder>\//`，文件用 `-path:/^<file>$/`（锚定并转义的正则，与 CMDK 的匹配规则一致）。

## Consequences

- 用户无需每次手动写 `-path:`。
- 注入运算符会让排除语法出现在搜索框里（可见但可忽略）。Obsidian 不提供独立的"排除列表"API，注入查询是唯一可行手段；若后续需要隐藏，可改为监听查询变更后静默重拼。
- 文件夹排除按路径前缀，会同时排除其子文件夹。
