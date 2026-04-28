<div align="center">

# JumpJump

### Repository-local bookmarks for folders, files, and code locations

[![version](https://img.shields.io/visual-studio-marketplace/v/SivanLiu.jumpjump?label=version&color=2389d7)](https://marketplace.visualstudio.com/items?itemName=SivanLiu.jumpjump)
![platform](https://img.shields.io/badge/platform-VS%20Code%20%7C%20Cursor-8a8a8a)
![built with](https://img.shields.io/badge/built%20with-TypeScript-3178c6)
[![downloads](https://img.shields.io/visual-studio-marketplace/d/SivanLiu.jumpjump?label=downloads&color=39b91f)](https://marketplace.visualstudio.com/items?itemName=SivanLiu.jumpjump)
[![license](https://img.shields.io/badge/license-Apache--2.0-orange)](LICENSE)

English | [中文](#chinese) | [Changelog](CHANGELOG.md)

</div>

---

## English

JumpJump turns frequently used repository folders, files, and code locations into a clean navigation panel inside VS Code and Cursor.

Instead of searching for the same paths again and again, you can save them as repository-local bookmarks, organize them into groups, and jump back with one click.

## Why JumpJump

- Save folders, files, and exact code locations as reusable bookmarks
- Keep bookmarks inside each repository with `.jumpjump/bookmarks.json`
- Organize bookmarks into custom groups
- Sort each group independently by manual order, name, added time, updated time, or type
- Pin important items within the current group
- Reorder groups and manually move items up or down
- Clean invalid bookmarks after files or folders are moved or deleted

## Typical Use Cases

- Switch between `cmd/`, `internal/`, and `pkg/` in Go repositories
- Jump between `app/`, `services/`, and `scripts/` in Python projects
- Save entry files, config files, route files, and debugging locations
- Share team navigation points by committing `.jumpjump/bookmarks.json`

## Quick Start

1. Install `JumpJump` from the VS Code Marketplace.
2. Open a repository in VS Code or Cursor.
3. Click the `JumpJump` icon in the Activity Bar.
4. Add bookmarks from editor context menus, explorer context menus, or the sidebar.

## Entry Points

- Editor tab context menu:
  - `JumpJump · 添加本文件 / Add Current File`
  - `JumpJump · 添加本文件所在目录 / Add Current Folder`
- Editor context menu:
  - `JumpJump · 添加当前代码位置 / Add Current Location`
- Explorer folder context menu:
  - `JumpJump · 文件夹 / Folder`
- Sidebar actions:
  - `添加`
  - `清理失效书签`
  - `刷新 / Refresh`

## Bookmark Types

JumpJump supports three bookmark types:

- Folder
- File
- Code location

New bookmarks are added to `Ungrouped` first, so you can collect locations quickly and organize them later.

## Groups And Sorting

- `Ungrouped` is the default system group.
- You can create custom groups for modules, workflows, or business domains.
- Bookmarks can be moved into any group.
- Custom groups can be reordered by drag and drop.
- Each group has its own sorting mode:
  - manual order
  - name
  - added time
  - updated time
  - type

When a group uses manual sorting, item cards show move-up and move-down actions.

## Jumping And Maintenance

- Click a bookmark to open its target.
- Folder bookmarks reveal the folder.
- File bookmarks open the file.
- Code location bookmarks open the file and jump to the saved line.
- Missing targets are shown as invalid and can be cleaned with one action.

## Storage

JumpJump stores bookmarks in the current repository:

```text
.jumpjump/bookmarks.json
```

This means:

- Bookmarks are scoped to the current repository.
- Bookmarks are not shared across unrelated projects.
- Teams can commit shared navigation data to Git.

## Current Limits

- JumpJump currently works with one repository at a time.
- Code location bookmarks are based on `file path + line number`.
- Line numbers may drift after large file edits.
- Function, class, and symbol-level bookmarks are not supported yet.

## Privacy

JumpJump stores bookmarks inside the current repository and does not upload them to a remote service.

## License

JumpJump is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Bug Reports

- Report here: <https://github.com/SivanCola/JumpJump/issues>

---

<a id="chinese"></a>

## 中文说明

JumpJump 可以把仓库里的常用目录、文件和代码位置整理成可点击的导航入口。

从“反复搜索”到“分组管理 + 一键跳转”，这些操作都可以在一个侧边栏里完成。

## 为什么选 JumpJump

- 仓库级导航：把高频目录、文件、代码位置沉淀成长期可复用的书签
- 仓库内保存：书签写入 `.jumpjump/bookmarks.json`，可随仓库一起提交
- 分组整理：新增书签先进入 `未分组`，后续可手动归类到业务分组
- 分组内排序：每个分组独立支持 `手动 / 名称 / 添加时间 / 修改时间 / 类型`
- 组内优先级：支持组内置顶，不需要单独维护全局置顶区
- 快速维护：支持组内上移 / 下移、分组拖拽排序、失效书签清理

## 典型使用场景

- 在 Go 项目里频繁切换 `cmd/`、`internal/`、`pkg/`
- 在 Python 项目里频繁切换 `app/`、`services/`、`scripts/`
- 收藏入口文件、配置文件、路由文件、调试点位
- 团队把常用导航点跟仓库一起维护，而不是各自记忆

## 30 秒上手

1. 在 VS Code / Cursor 安装 `JumpJump`
2. 打开任意一个代码仓库
3. 点击 Activity Bar 中的 `JumpJump` 图标
4. 通过右键菜单或侧边栏 `添加` 把常用位置收进来

## 核心功能入口

- 编辑器标签页右键
  - `JumpJump · 添加本文件 / Add Current File`
  - `JumpJump · 添加本文件所在目录 / Add Current Folder`
- 编辑器内容区右键
  - `JumpJump · 添加当前代码位置 / Add Current Location`
- 资源管理器右键文件夹
  - `JumpJump · 文件夹 / Folder`
- 侧边栏按钮
  - `添加`
  - `清理失效书签`
  - `刷新 / Refresh`

## 书签类型

JumpJump 支持三类书签：

- 文件夹
- 文件
- 代码位置

新增后会默认进入 `未分组`，方便你先收集、后整理。

## 分组与排序

- `未分组` 是系统默认分组
- 你可以手动创建自己的业务分组
- 书签可移动到任意分组
- 自定义分组之间支持拖拽调整顺序
- 每个分组都可以单独设置排序方式：
  - 手动
  - 名称
  - 添加时间
  - 修改时间
  - 类型

当分组处于 `手动` 排序时，卡片上会显示上移 / 下移按钮。

## 跳转与维护

- 左键点击书签：直接打开目标
- 文件夹书签：定位目录
- 文件书签：打开文件
- 代码位置书签：打开文件并跳到指定行
- 目标不存在时：显示失效状态，并可一键清理

## 书签保存位置

JumpJump 会把数据保存在当前仓库根目录下：

```text
.jumpjump/bookmarks.json
```

这意味着：

- A 项目的书签不会在 B 项目中显示
- 书签属于仓库本身，而不是当前编辑器窗口
- 你可以把书签随项目一起提交到 Git

## 当前限制

- 当前版本按单一仓库工作，不做多仓库合并视图
- 代码位置书签基于 `文件路径 + 行号`
- 文件内容变化较大时，行号可能发生漂移
- 当前不支持函数 / 类 / 符号级书签

## 隐私说明

JumpJump 将书签保存在当前仓库内，不会把书签上传到远程服务。

## 开源协议

JumpJump 使用 Apache License, Version 2.0 开源。详见 [LICENSE](LICENSE)。

## Bug 反馈

- 提交地址：<https://github.com/SivanCola/JumpJump/issues>
