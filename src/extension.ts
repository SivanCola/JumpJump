import * as vscode from "vscode";
import * as path from "path";
import { BookmarkItem, BookmarkSortBy, BookmarkSortDirection, BookmarkType } from "./types";
import { BookmarkStore } from "./bookmarks/store";
import { openBookmark } from "./bookmarks/navigator";
import { JumpJumpSidebarProvider, JumpJumpUnavailableSidebarProvider } from "./sidebar/view";

type Locale = "zh" | "en";
const LOCALE_KEY = "jumpjump.locale";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = getSingleWorkspaceRoot();
  if (!workspaceRoot) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        JumpJumpUnavailableSidebarProvider.viewType,
        new JumpJumpUnavailableSidebarProvider(() => getLocale(context))
      )
    );
    registerUnavailableCommands(context);
    return;
  }

  const store = new BookmarkStore(workspaceRoot.fsPath);
  let sidebarProvider: JumpJumpSidebarProvider | undefined;

  const refreshSidebar = async (): Promise<void> => {
    await sidebarProvider?.refresh();
  };

  sidebarProvider = new JumpJumpSidebarProvider(
    context.extensionUri,
    path.basename(workspaceRoot.fsPath) || "Workspace",
    store,
    {
    addCurrentFile: async () => {
      await addCurrentEditorBookmark(store, "file", context, sidebarProvider);
      await refreshSidebar();
    },
    addCurrentLine: async () => {
      await addCurrentEditorBookmark(store, "line", context, sidebarProvider);
      await refreshSidebar();
    },
    addCurrentFolder: async () => {
      await addCurrentFolderBookmark(store, context, sidebarProvider);
      await refreshSidebar();
    },
    removeMissing: async () => {
      await removeMissingBookmarks(store, context);
      await refreshSidebar();
    },
    togglePinned: async (bookmark) => {
      await togglePinned(store, bookmark);
      await refreshSidebar();
    },
    openBookmark: async (bookmark) => {
      await store.markOpened(bookmark.id);
      await openBookmark(store, bookmark);
      await refreshSidebar();
    },
    renameBookmark: async (bookmark, label) => {
      await renameBookmark(store, bookmark, context, label);
      await refreshSidebar();
    },
    createGroup: async (name) => {
      await createGroup(store, context, name);
      await refreshSidebar();
    },
    renameGroup: async (groupId, name) => {
      await renameGroup(store, groupId, context, name);
      await refreshSidebar();
    },
    deleteGroup: async (groupId) => {
      await deleteGroup(store, groupId, context);
      await refreshSidebar();
    },
    moveBookmarkToGroup: async (bookmark, groupId) => {
      await moveBookmarkToGroup(store, bookmark, context, groupId);
      await refreshSidebar();
    },
    setGroupSort: async (groupId, sortBy) => {
      await setGroupSort(store, groupId, sortBy);
      await refreshSidebar();
    },
    moveBookmarkWithinGroup: async (bookmark, direction) => {
      await store.moveBookmarkWithinGroup(bookmark.id, direction);
      await refreshSidebar();
    },
    setGroupCollapsed: async (groupId, collapsed) => {
      await store.setGroupCollapsed(groupId, collapsed);
      await refreshSidebar();
    },
    reorderGroups: async (groupIds) => {
      await store.reorderGroups(groupIds);
      await refreshSidebar();
    },
    deleteBookmark: async (bookmark) => {
      await deleteBookmark(store, bookmark, context);
      await refreshSidebar();
    }
  },
    () => getLocale(context),
    async (locale) => {
      await setLocale(context, locale);
      await refreshSidebar();
    }
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(JumpJumpSidebarProvider.viewType, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("jumpjump.refresh", async () => {
      await guardedAction(refreshSidebar());
    }),
    vscode.commands.registerCommand("jumpjump.addCurrentFile", async () => {
      await guardedAction(addCurrentEditorBookmark(store, "file", context, sidebarProvider), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.addCurrentLine", async () => {
      await guardedAction(addCurrentEditorBookmark(store, "line", context, sidebarProvider), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.addCurrentFolder", async () => {
      await guardedAction(addCurrentFolderBookmark(store, context, sidebarProvider), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.addFolder", async (resource?: vscode.Uri) => {
      await guardedAction(addFolderBookmark(store, resource, context, sidebarProvider), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.togglePinned", async (bookmark: BookmarkItem) => {
      await guardedAction(togglePinned(store, bookmark), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.openBookmark", async (bookmark: BookmarkItem) => {
      await guardedAction(openBookmarkAndTrack(store, bookmark), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.deleteBookmark", async (bookmark: BookmarkItem) => {
      await guardedAction(deleteBookmark(store, bookmark, context), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.renameBookmark", async (bookmark?: BookmarkItem) => {
      await guardedAction(renameBookmark(store, bookmark, context), refreshSidebar);
    }),
    vscode.commands.registerCommand("jumpjump.removeMissing", async () => {
      await guardedAction(removeMissingBookmarks(store, context), refreshSidebar);
    })
  );

  await guardedAction(refreshSidebar());
}

export function deactivate(): void {}

async function addCurrentEditorBookmark(
  store: BookmarkStore,
  type: Extract<BookmarkType, "file" | "line">,
  context: vscode.ExtensionContext,
  sidebarProvider?: JumpJumpSidebarProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(tr(context, "warning.noEditor"));
    return;
  }

  const absolutePath = editor.document.uri.fsPath;
  const label = buildSuggestedLabel(type, absolutePath, editor.selection.active.line + 1);

  const bookmark = await store.addBookmark({
    type,
    label,
    absolutePath,
    line: type === "line" ? editor.selection.active.line + 1 : undefined
  });
  sidebarProvider?.highlightBookmark(bookmark.id);
}

async function addCurrentFolderBookmark(store: BookmarkStore, context: vscode.ExtensionContext, sidebarProvider?: JumpJumpSidebarProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(tr(context, "warning.noEditorForFolder"));
    return;
  }
  await addFolderBookmark(store, vscode.Uri.file(path.dirname(editor.document.uri.fsPath)), context, sidebarProvider);
}

async function addFolderBookmark(
  store: BookmarkStore,
  resource: vscode.Uri | undefined,
  context: vscode.ExtensionContext,
  sidebarProvider?: JumpJumpSidebarProvider
): Promise<void> {
  if (!resource) {
    void vscode.window.showWarningMessage(tr(context, "warning.useExplorerFolder"));
    return;
  }

  const label = `${path.basename(resource.fsPath) || "文件夹"}/`;

  const bookmark = await store.addBookmark({
    type: "folder",
    label,
    absolutePath: resource.fsPath
  });
  sidebarProvider?.highlightBookmark(bookmark.id);
}

async function deleteBookmark(store: BookmarkStore, bookmark: BookmarkItem, context: vscode.ExtensionContext): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    tr(context, "confirm.deleteBookmark", bookmark.label),
    { modal: true },
    tr(context, "action.delete")
  );
  if (confirmed !== tr(context, "action.delete")) {
    return;
  }
  const deleted = await store.deleteBookmark(bookmark.id);
  if (!deleted) {
    void vscode.window.showWarningMessage(tr(context, "warning.bookmarkNotFound"));
    return;
  }
}

async function renameBookmark(
  store: BookmarkStore,
  bookmark: BookmarkItem | undefined,
  context: vscode.ExtensionContext,
  nextLabel?: string
): Promise<void> {
  if (!bookmark) {
    throw new Error(tr(context, "warning.bookmarkRenameInSidebar"));
  }
  const resolvedLabel = typeof nextLabel === "string" ? nextLabel.trim() : "";

  if (!resolvedLabel) {
    throw new Error(tr(context, "warning.bookmarkRenameInSidebar"));
  }
  await store.renameBookmark(bookmark.id, resolvedLabel);
}

async function createGroup(store: BookmarkStore, context: vscode.ExtensionContext, nextName?: string): Promise<void> {
  const resolvedName = typeof nextName === "string" ? nextName.trim() : "";
  if (!resolvedName) {
    throw new Error(tr(context, "warning.groupFormRequired"));
  }
  await store.createGroup(resolvedName);
}

async function renameGroup(
  store: BookmarkStore,
  groupId: string,
  context: vscode.ExtensionContext,
  nextName?: string
): Promise<void> {
  const file = await store.read();
  const group = file.groups.find((entry) => entry.id === groupId);
  if (!group || group.system) {
    return;
  }
  const name = typeof nextName === "string" ? nextName.trim() : "";
  if (!name) {
    throw new Error(tr(context, "warning.groupFormRequired"));
  }
  await store.renameGroup(groupId, name);
}

async function deleteGroup(store: BookmarkStore, groupId: string, context: vscode.ExtensionContext): Promise<void> {
  const file = await store.read();
  const group = file.groups.find((entry) => entry.id === groupId);
  if (!group || group.system) {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    tr(context, "confirm.deleteGroup", group.name),
    { modal: true },
    tr(context, "action.delete")
  );
  if (confirmed !== tr(context, "action.delete")) {
    return;
  }
  await store.deleteGroup(groupId);
}

async function moveBookmarkToGroup(
  store: BookmarkStore,
  bookmark: BookmarkItem,
  context: vscode.ExtensionContext,
  groupId?: string
): Promise<void> {
  if (groupId) {
    await store.moveBookmarkToGroup(bookmark.id, groupId);
    return;
  }
  throw new Error(tr(context, "warning.groupPickerRequired"));
}

async function setGroupSort(store: BookmarkStore, groupId: string, sortBy: BookmarkSortBy): Promise<void> {
  const direction: BookmarkSortDirection = sortBy === "createdAt" || sortBy === "updatedAt" ? "desc" : "asc";
  await store.setGroupSort(groupId, sortBy, direction);
}

async function togglePinned(store: BookmarkStore, bookmark: BookmarkItem): Promise<void> {
  await store.togglePinned(bookmark.id);
}

async function removeMissingBookmarks(store: BookmarkStore, context: vscode.ExtensionContext): Promise<void> {
  const removed = await store.removeMissingBookmarks();
  void vscode.window.showInformationMessage(
    removed > 0 ? tr(context, "info.cleanedMissing", String(removed)) : tr(context, "info.noMissing")
  );
}

async function openBookmarkAndTrack(store: BookmarkStore, bookmark: BookmarkItem): Promise<void> {
  await store.markOpened(bookmark.id);
  await openBookmark(store, bookmark);
}

function getSingleWorkspaceRoot(): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length !== 1) {
    return undefined;
  }
  return folders[0].uri;
}

function registerUnavailableCommands(context: vscode.ExtensionContext): void {
  const warn = async (): Promise<void> => {
    void vscode.window.showWarningMessage(tr(context, "warning.singleWorkspaceOnly"));
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("jumpjump.refresh", warn),
    vscode.commands.registerCommand("jumpjump.addCurrentFile", warn),
    vscode.commands.registerCommand("jumpjump.addCurrentLine", warn),
    vscode.commands.registerCommand("jumpjump.addCurrentFolder", warn),
    vscode.commands.registerCommand("jumpjump.addFolder", warn),
    vscode.commands.registerCommand("jumpjump.togglePinned", warn),
    vscode.commands.registerCommand("jumpjump.openBookmark", warn),
    vscode.commands.registerCommand("jumpjump.deleteBookmark", warn),
    vscode.commands.registerCommand("jumpjump.renameBookmark", warn),
    vscode.commands.registerCommand("jumpjump.removeMissing", warn)
  );
}

async function guardedAction(action: Promise<void>, refresh?: () => Promise<void>): Promise<void> {
  try {
    await action;
  } catch (error) {
    void vscode.window.showErrorMessage((error as Error).message);
  } finally {
    if (refresh) {
      await refresh().catch(() => undefined);
    }
  }
}

function buildSuggestedLabel(type: Extract<BookmarkType, "file" | "line">, absolutePath: string, lineNumber: number): string {
  const fileName = path.basename(absolutePath) || "untitled";
  return type === "line" ? `${fileName}:${lineNumber}` : fileName;
}

function getLocale(context: vscode.ExtensionContext): Locale {
  const value = context.globalState.get<string>(LOCALE_KEY);
  return value === "en" ? "en" : "zh";
}

async function setLocale(context: vscode.ExtensionContext, locale: Locale): Promise<void> {
  await context.globalState.update(LOCALE_KEY, locale);
}

function tr(context: vscode.ExtensionContext, key: string, arg?: string): string {
  return translate(getLocale(context), key, arg);
}

function translate(locale: Locale, key: string, arg?: string): string {
  const zh: Record<string, string> = {
    "warning.noEditor": "当前没有打开的编辑器。",
    "warning.noEditorForFolder": "当前没有打开的编辑器，无法确定目录。",
    "warning.useExplorerFolder": "请在资源管理器中右键文件夹后添加。",
    "warning.bookmarkNotFound": "未找到要删除的书签。",
    "warning.bookmarkRenameInSidebar": "请在 JumpJump 侧边栏内联编辑书签名称。",
    "warning.singleWorkspaceOnly": "JumpJump 需要在单一工作区中使用。请先打开一个项目目录。",
    "warning.groupFormRequired": "请在 JumpJump 侧边栏内完成分组名称输入。",
    "warning.groupPickerRequired": "请在 JumpJump 侧边栏内选择目标分组。",
    "confirm.deleteBookmark": `删除书签“${arg ?? ""}”？`,
    "confirm.deleteGroup": `删除分组“${arg ?? ""}”？组内书签会回到“未分组”。`,
    "action.delete": "删除",
    "action.rename": "改名",
    "input.createGroupTitle": "新建分组",
    "input.createGroupPrompt": "输入新的分组名称",
    "input.renameGroupTitle": "重命名分组",
    "input.renameGroupPrompt": "输入新的分组名称",
    "picker.moveBookmarkTitle": "移动书签到分组",
    "picker.moveBookmarkPlaceholder": "选择一个目标分组",
    "picker.sortGroupTitle": `设置分组排序：${arg ?? ""}`,
    "picker.sortGroupPlaceholder": "选择该分组的排序方式",
    "group.system": "系统分组",
    "group.custom": "自定义分组",
    "sort.manual": "手动排序",
    "sort.manualDesc": "显示上移/下移按钮，由你手动调整顺序",
    "sort.label": "按名称",
    "sort.labelDesc": "按书签名称 A-Z 排序",
    "sort.createdAt": "按添加时间",
    "sort.createdAtDesc": "最近添加的书签排在前面",
    "sort.updatedAt": "按修改时间",
    "sort.updatedAtDesc": "最近更新的书签排在前面",
    "sort.type": "按类型",
    "sort.typeDesc": "目录、文件、代码位置分组展示",
    "info.cleanedMissing": `已清理 ${arg ?? "0"} 个失效书签。`,
    "info.noMissing": "没有需要清理的失效书签。"
  };
  const en: Record<string, string> = {
    "warning.noEditor": "No active editor is open.",
    "warning.noEditorForFolder": "No active editor is open, so the current folder cannot be determined.",
    "warning.useExplorerFolder": "Please add a folder from the Explorer context menu.",
    "warning.bookmarkNotFound": "The bookmark could not be found.",
    "warning.bookmarkRenameInSidebar": "Please rename bookmarks inline inside the JumpJump sidebar.",
    "warning.singleWorkspaceOnly": "JumpJump works in a single-root workspace. Please open one project folder first.",
    "warning.groupFormRequired": "Please enter the group name inside the JumpJump sidebar.",
    "warning.groupPickerRequired": "Please choose a target group inside the JumpJump sidebar.",
    "confirm.deleteBookmark": `Delete bookmark "${arg ?? ""}"?`,
    "confirm.deleteGroup": `Delete group "${arg ?? ""}"? Its bookmarks will move back to "Ungrouped".`,
    "action.delete": "Delete",
    "action.rename": "Rename",
    "input.createGroupTitle": "Create Group",
    "input.createGroupPrompt": "Enter a group name",
    "input.renameGroupTitle": "Rename Group",
    "input.renameGroupPrompt": "Enter a new group name",
    "picker.moveBookmarkTitle": "Move Bookmark",
    "picker.moveBookmarkPlaceholder": "Choose a target group",
    "picker.sortGroupTitle": `Sort Group: ${arg ?? ""}`,
    "picker.sortGroupPlaceholder": "Choose a sort mode for this group",
    "group.system": "System group",
    "group.custom": "Custom group",
    "sort.manual": "Manual",
    "sort.manualDesc": "Show move up/down controls and arrange items yourself",
    "sort.label": "Label",
    "sort.labelDesc": "Sort bookmarks by label from A to Z",
    "sort.createdAt": "Created time",
    "sort.createdAtDesc": "Newest bookmarks first",
    "sort.updatedAt": "Updated time",
    "sort.updatedAtDesc": "Most recently updated first",
    "sort.type": "Type",
    "sort.typeDesc": "Group by folder, file, and code location",
    "info.cleanedMissing": `Removed ${arg ?? "0"} missing bookmark(s).`,
    "info.noMissing": "There are no missing bookmarks to clean up."
  };
  return (locale === "en" ? en : zh)[key] ?? key;
}
