# JumpJump

在仓库里把常用目录、文件和代码位置整理成可点击的导航入口。  
从“反复搜索”到“分组管理 + 一键跳转”，在一个侧边栏里完成。

---

## 中文说明

### 为什么选 JumpJump

- 仓库级导航：把高频目录、文件、代码位置沉淀成长期可复用的书签
- 分组整理：新增书签先进入 `未分组`，后续可手动归类到业务分组
- 分组内排序：每个分组独立支持 `手动 / 名称 / 添加时间 / 修改时间 / 类型`
- 组内优先级：支持组内置顶，不需要单独维护全局置顶区
- 快速维护：支持组内上移 / 下移、分组拖拽排序、失效书签清理
- 仓库内保存：书签写入 `.jumpjump/bookmarks.json`，可随仓库一起提交

### 典型使用场景

- 在 Go 项目里频繁切换 `cmd/`、`internal/`、`pkg/`
- 在 Python 项目里频繁切换 `app/`、`services/`、`scripts/`
- 收藏入口文件、配置文件、路由文件、调试点位
- 团队把常用导航点跟仓库一起维护，而不是各自记忆

### 30 秒上手

1. 在 VS Code / Cursor 安装 `JumpJump`
2. 打开任意一个代码仓库
3. 点击 Activity Bar 中的 `JumpJump` 图标
4. 通过右键菜单或侧边栏 `添加` 把常用位置收进来

### 核心功能入口

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

### 使用方式

#### 添加书签

JumpJump 支持三类书签：

- 文件夹
- 文件
- 代码位置

新增后会默认进入 `未分组`，方便你先收集、后整理。

#### 分组管理

- `未分组` 是系统默认分组
- 你可以手动创建自己的业务分组
- 书签可移动到任意分组
- 自定义分组之间支持拖拽调整顺序

#### 分组排序

每个分组都可以单独设置排序方式：

- 手动
- 名称
- 添加时间
- 修改时间
- 类型

说明：

- `添加时间` 指的是书签被加入 JumpJump 的时间
- `修改时间` 指的是书签被改名、移动分组、置顶等操作后的时间
- 当分组处于 `手动` 排序时，卡片上会显示上移 / 下移按钮

#### 跳转与维护

- 左键点击书签：直接打开目标
- 文件夹书签：定位目录
- 文件书签：打开文件
- 代码位置书签：打开文件并跳到指定行
- 目标不存在时：显示失效状态，并可一键清理

### 书签保存位置

JumpJump 会把数据保存在当前仓库根目录下：

```text
.jumpjump/bookmarks.json
```

这意味着：

- A 项目的书签不会在 B 项目中显示
- 书签属于仓库本身，而不是当前编辑器窗口
- 你可以把书签随项目一起提交到 Git

### 当前限制

- 当前版本按单一仓库工作，不做多仓库合并视图
- 代码位置书签基于 `文件路径 + 行号`
- 文件内容变化较大时，行号可能发生漂移
- 当前不支持函数 / 类 / 符号级书签

---

## English

JumpJump gives you a repository-local navigation panel for folders, files, and code locations.

### Why JumpJump

- Turn frequently used locations into reusable bookmarks
- Organize bookmarks into custom groups
- Sort each group independently
- Pin important items within a group
- Reorder groups by drag and drop
- Store everything inside the repo with `.jumpjump/bookmarks.json`

### Quick Start

1. Install `JumpJump` from VS Code Marketplace
2. Open a repository in VS Code or Cursor
3. Click the `JumpJump` icon in the Activity Bar
4. Add bookmarks from editor context menus or the sidebar `Add` menu

### Main Entry Points

- `JumpJump · 添加本文件 / Add Current File`
- `JumpJump · 添加当前代码位置 / Add Current Location`
- `JumpJump · 添加本文件所在目录 / Add Current Folder`
- `JumpJump · 刷新 / Refresh`
- `JumpJump · 清理失效书签 / Clean Missing`

### What You Can Do

- Save folders, files, and code locations
- Put new bookmarks into `Ungrouped` first
- Move bookmarks into custom groups later
- Sort each group by:
  - manual order
  - label
  - added time
  - updated time
  - type
- Pin important items within the current group
- Clean invalid paths when files or folders are removed

### Storage

Bookmarks are stored in the current repository:

```text
.jumpjump/bookmarks.json
```

That means JumpJump works per repository, not as one global bookmark list across all projects.

---

## 隐私说明 / Privacy

JumpJump 将书签保存在当前仓库内，不会把书签上传到远程服务。  
JumpJump stores bookmarks inside the current repository and does not upload them to a remote service.

## 开源协议 / License

JumpJump is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

## Bug 反馈 / Bug Reports

- 提交地址 / Report here: <https://github.com/SivanCola/issues/issues>
