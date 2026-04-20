import * as fs from "fs/promises";
import * as vscode from "vscode";
import { BookmarkGroup, BookmarkItem, BookmarkSortBy } from "../types";
import { BookmarkStore } from "../bookmarks/store";
import { UNGROUPED_GROUP_ID } from "../bookmarks/schema";

interface SidebarSection {
  id: string;
  groupId: string;
  title: string;
  subtitle?: string;
  tone: "default" | "accent" | "warning";
  collapsible: boolean;
  collapsed: boolean;
  sortBy: BookmarkSortBy;
  system: boolean;
  draggable: boolean;
  density?: "compact" | "comfortable";
  items: SidebarBookmarkItem[];
}

interface SidebarBookmarkItem {
  id: string;
  label: string;
  path: string;
  type: BookmarkItem["type"];
  line?: number;
  missing: boolean;
  pinned: boolean;
  lastOpenedAt?: string;
}

interface SidebarState {
  locale: "zh" | "en";
  workspaceName: string;
  total: number;
  groups: number;
  missing: number;
  pinned: number;
  highlightedBookmarkId?: string;
  sections: SidebarSection[];
  hasItems: boolean;
}

type SidebarMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "toggleLanguage" }
  | { type: "addCurrentFile" }
  | { type: "addCurrentLine" }
  | { type: "addCurrentFolder" }
  | { type: "createGroup"; name?: string }
  | { type: "renameGroup"; groupId: string; name?: string }
  | { type: "deleteGroup"; groupId: string }
  | { type: "setGroupSort"; groupId: string; sortBy: BookmarkSortBy }
  | { type: "toggleGroupCollapsed"; groupId: string; collapsed: boolean }
  | { type: "reorderGroups"; groupIds: string[] }
  | { type: "removeMissing" }
  | { type: "openBookmark"; id: string }
  | { type: "renameBookmark"; id: string; label?: string }
  | { type: "deleteBookmark"; id: string }
  | { type: "togglePinned"; id: string }
  | { type: "moveBookmarkToGroup"; id: string; groupId?: string }
  | { type: "moveBookmarkWithinGroup"; id: string; direction: "up" | "down" };

export class JumpJumpSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "jumpjump.bookmarks";

  private view?: vscode.WebviewView;
  private highlightedBookmarkId?: string;
  private highlightTimer?: NodeJS.Timeout;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceName: string,
    private readonly store: BookmarkStore,
    private readonly commandHandlers: {
      addCurrentFile: () => Promise<void>;
      addCurrentLine: () => Promise<void>;
      addCurrentFolder: () => Promise<void>;
      createGroup: (name?: string) => Promise<void>;
      renameGroup: (groupId: string, name?: string) => Promise<void>;
      deleteGroup: (groupId: string) => Promise<void>;
      setGroupSort: (groupId: string, sortBy: BookmarkSortBy) => Promise<void>;
      setGroupCollapsed: (groupId: string, collapsed: boolean) => Promise<void>;
      reorderGroups: (groupIds: string[]) => Promise<void>;
      removeMissing: () => Promise<void>;
      togglePinned: (bookmark: BookmarkItem) => Promise<void>;
      moveBookmarkToGroup: (bookmark: BookmarkItem, groupId?: string) => Promise<void>;
      moveBookmarkWithinGroup: (bookmark: BookmarkItem, direction: "up" | "down") => Promise<void>;
      openBookmark: (bookmark: BookmarkItem) => Promise<void>;
      renameBookmark: (bookmark: BookmarkItem, label?: string) => Promise<void>;
      deleteBookmark: (bookmark: BookmarkItem) => Promise<void>;
    },
    private readonly getLocale: () => "zh" | "en",
    private readonly setLocale: (locale: "zh" | "en") => Promise<void>
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.onDidReceiveMessage(async (message: SidebarMessage) => {
      await this.handleMessage(message);
    });

    webviewView.webview.html = this.getHtml(webviewView.webview);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await this.buildState();
    await this.view.webview.postMessage({ type: "state", payload: state });
  }

  private async handleMessage(message: SidebarMessage): Promise<void> {
    switch (message.type) {
      case "ready":
      case "refresh":
        await this.refresh();
        return;
      case "toggleLanguage":
        await this.setLocale(this.getLocale() === "zh" ? "en" : "zh");
        await this.refresh();
        return;
      case "addCurrentFile":
        await this.commandHandlers.addCurrentFile();
        return;
      case "addCurrentLine":
        await this.commandHandlers.addCurrentLine();
        return;
      case "addCurrentFolder":
        await this.commandHandlers.addCurrentFolder();
        return;
      case "createGroup":
        await this.commandHandlers.createGroup(message.name);
        return;
      case "renameGroup":
        await this.commandHandlers.renameGroup(message.groupId);
        return;
      case "deleteGroup":
        await this.commandHandlers.deleteGroup(message.groupId);
        return;
      case "setGroupSort":
        await this.commandHandlers.setGroupSort(message.groupId, message.sortBy);
        return;
      case "toggleGroupCollapsed":
        await this.commandHandlers.setGroupCollapsed(message.groupId, message.collapsed);
        return;
      case "reorderGroups":
        await this.commandHandlers.reorderGroups(message.groupIds);
        return;
      case "removeMissing":
        await this.commandHandlers.removeMissing();
        return;
      case "togglePinned": {
        const bookmark = await this.findBookmark(message.id);
        if (bookmark) {
          await this.commandHandlers.togglePinned(bookmark);
        }
        return;
      }
      case "openBookmark": {
        const bookmark = await this.findBookmark(message.id);
        if (bookmark) {
          await this.commandHandlers.openBookmark(bookmark);
        }
        return;
      }
      case "renameBookmark": {
        const bookmark = await this.findBookmark(message.id);
        if (bookmark) {
          await this.commandHandlers.renameBookmark(bookmark, message.label);
        }
        return;
      }
      case "moveBookmarkToGroup": {
        const bookmark = await this.findBookmark(message.id);
        if (bookmark) {
          await this.commandHandlers.moveBookmarkToGroup(bookmark, message.groupId);
        }
        return;
      }
      case "moveBookmarkWithinGroup": {
        const bookmark = await this.findBookmark(message.id);
        if (bookmark) {
          await this.commandHandlers.moveBookmarkWithinGroup(bookmark, message.direction);
        }
        return;
      }
      case "deleteBookmark": {
        const bookmark = await this.findBookmark(message.id);
        if (bookmark) {
          await this.commandHandlers.deleteBookmark(bookmark);
        }
      }
    }
  }

  private async findBookmark(id: string): Promise<BookmarkItem | undefined> {
    const file = await this.store.ensureInitialized();
    return file.items.find((item) => item.id === id);
  }

  private async buildState(): Promise<SidebarState> {
    const locale = this.getLocale();
    const file = await this.store.ensureInitialized();
    const itemsWithState = await Promise.all(
      file.items.map(async (item) => ({
        ...item,
        pinned: item.pinned === true,
        missing: !(await pathExists(this.store.resolveAbsolutePath(item.path)))
      }))
    );
    const sections = file.groups
      .slice()
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN"))
      .map((group) => buildSidebarSection(locale, group, itemsWithState.filter((item) => item.groupId === group.id)));

    return {
      locale,
      workspaceName: this.workspaceName,
      total: file.items.length,
      groups: file.groups.filter((group) => !group.system).length,
      missing: itemsWithState.filter((item) => item.missing).length,
      pinned: itemsWithState.filter((item) => item.pinned).length,
      highlightedBookmarkId: this.highlightedBookmarkId,
      sections,
      hasItems: file.items.length > 0
    };
  }

  highlightBookmark(id: string): void {
    this.highlightedBookmarkId = id;
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
    void this.refresh();
    this.highlightTimer = setTimeout(() => {
      this.highlightedBookmarkId = undefined;
      void this.refresh();
    }, 1800);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JumpJump</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --panel: color-mix(in srgb, var(--vscode-sideBar-background) 84%, white 16%);
        --panel-2: color-mix(in srgb, var(--vscode-sideBar-background) 92%, white 8%);
        --panel-3: color-mix(in srgb, var(--vscode-sideBar-background) 78%, black 22%);
        --border: color-mix(in srgb, var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.22)) 72%, white 28%);
        --fg: var(--vscode-sideBar-foreground);
        --muted: var(--vscode-descriptionForeground);
        --accent: color-mix(in srgb, var(--vscode-button-background) 88%, #6d8dff 12%);
        --accent-soft: rgba(109, 141, 255, 0.18);
        --accent-fg: var(--vscode-button-foreground);
        --success: #3ecf8e;
        --warning: #ffb86b;
        --danger: var(--vscode-errorForeground);
        --focus: var(--vscode-focusBorder);
        --shadow-lg: 0 18px 40px rgba(0, 0, 0, 0.22);
        --shadow-md: 0 10px 24px rgba(0, 0, 0, 0.16);
        --radius-xl: 18px;
        --radius-lg: 14px;
        --radius-md: 12px;
        --radius-sm: 10px;
      }

      * { box-sizing: border-box; }
      html {
        scroll-behavior: smooth;
        scrollbar-gutter: stable;
      }
      body {
        margin: 0;
        color: var(--fg);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
        overflow-y: auto;
        background:
          radial-gradient(circle at top right, rgba(80, 115, 255, 0.16), transparent 28%),
          radial-gradient(circle at top left, rgba(33, 202, 255, 0.08), transparent 22%),
          linear-gradient(180deg, color-mix(in srgb, var(--bg) 82%, black 18%), var(--bg));
      }

      button, input {
        font: inherit;
      }

      .app {
        padding: 14px;
        display: grid;
        gap: 14px;
        animation: fadeUp .22s ease-out;
      }

      .hero {
        position: relative;
        overflow: hidden;
        padding: 14px;
        border-radius: var(--radius-xl);
        border: 1px solid var(--border);
        background:
          linear-gradient(165deg, rgba(102, 125, 255, 0.22), rgba(12, 14, 27, 0.14)),
          linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01));
        box-shadow: var(--shadow-lg);
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -20% -40% auto;
        width: 180px;
        height: 180px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(62, 207, 142, 0.18), transparent 68%);
        pointer-events: none;
      }

      .eyebrow {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .1em;
        color: var(--muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .hero-top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 10px;
      }

      .hero-copy {
        min-width: 0;
      }

      .title-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
        justify-content: flex-end;
        justify-self: end;
        flex-shrink: 0;
      }

      h1 {
        margin: 6px 0 0;
        font-size: 17px;
        letter-spacing: -0.02em;
        line-height: 1.15;
      }

      .subtitle {
        margin-top: 6px;
        max-width: 32ch;
        color: var(--muted);
        font-size: 12px;
      }

      .workspace-pill {
        border: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.06);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
        min-height: 24px;
        padding: 0 8px;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .locale-toggle {
        min-height: 24px;
        min-width: 62px;
        padding: 0 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.05);
        color: var(--fg);
        cursor: pointer;
        transition: transform .14s ease, filter .14s ease;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .locale-toggle:hover {
        transform: translateY(-1px);
        filter: brightness(1.05);
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }

      .stat {
        min-width: 0;
        padding: 8px 10px;
        border-radius: var(--radius-md);
        border: 1px solid rgba(255,255,255,.06);
        background: rgba(8, 12, 22, 0.18);
        backdrop-filter: blur(10px);
      }

      .stat-label {
        font-size: 11px;
        color: var(--muted);
      }

      .stat-value {
        margin-top: 3px;
        font-size: 17px;
        font-weight: 700;
      }

      .toolbar-card,
      .empty,
      .section {
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
        box-shadow: var(--shadow-md);
      }

      .toolbar-card {
        position: relative;
        overflow: hidden;
        padding: 14px;
        display: grid;
        gap: 12px;
        border-color: color-mix(in srgb, var(--border) 78%, rgba(109,141,255,.28));
        background:
          linear-gradient(180deg, rgba(109,141,255,.16), rgba(109,141,255,.05) 38%, rgba(255,255,255,.02)),
          linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.05), var(--shadow-md);
      }

      .toolbar-card::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
          radial-gradient(circle at top right, rgba(109, 141, 255, 0.14), transparent 36%),
          radial-gradient(circle at bottom left, rgba(62, 207, 142, 0.06), transparent 28%);
        opacity: .95;
      }

      .toolbar-card::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
      }

      .toolbar-actions {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
      }

      .action-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .toolbar-primary {
        position: relative;
      }

      .action {
        min-height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--fg);
        background: rgba(255,255,255,.03);
        cursor: pointer;
        transition: transform .14s ease, filter .14s ease, border-color .14s ease, background .14s ease, box-shadow .14s ease;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
      }

      .action.has-caret::after {
        content: "▾";
        font-size: 15px;
        line-height: 1;
        opacity: .92;
        transform: translateY(-1px);
      }

      .action.secondary {
        color: var(--fg);
        background: var(--panel);
        border-color: var(--border);
      }

      .action.subtle {
        color: var(--fg);
        background: rgba(255,255,255,.03);
        border-color: var(--border);
      }

      .action.subtle.has-caret {
        color: var(--fg);
        gap: 10px;
        background: linear-gradient(180deg, rgba(109,141,255,.16), rgba(255,255,255,.03));
        border-color: color-mix(in srgb, var(--border) 78%, rgba(109,141,255,.3));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
      }

      .action:hover,
      .chip:hover,
      .bookmark:hover,
      .bookmark-menu:hover {
        transform: translateY(-1px);
        filter: brightness(1.04);
      }

      .action:focus-visible,
      .chip:focus-visible,
      .bookmark-menu:focus-visible,
      .locale-toggle:focus-visible,
      .section-toggle:focus-visible,
      .search-input:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 2px;
      }

      .search-row {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 10px;
      }

      .search-input {
        width: 100%;
        min-height: 38px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-2) 82%, rgba(109,141,255,.12));
        color: var(--fg);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.03);
        color: var(--muted);
        cursor: pointer;
        transition: all .14s ease;
      }

      .chip.active {
        color: var(--fg);
        background: linear-gradient(180deg, rgba(109,141,255,.24), rgba(109,141,255,.12));
        border-color: rgba(109, 141, 255, .34);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
      }

      .empty {
        display: none;
        padding: 18px;
        gap: 12px;
      }

      .empty.visible {
        display: grid;
        animation: fadeUp .18s ease-out;
      }

      .empty-title {
        margin: 0;
        font-size: 16px;
      }

      .empty-copy,
      .empty-checklist,
      .meta,
      .footer-tip {
        color: var(--muted);
      }

      .empty-checklist {
        display: grid;
        gap: 6px;
        font-size: 12px;
      }

      .sections {
        display: grid;
        gap: 12px;
      }

      .section {
        overflow: hidden;
      }

      .section-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
      }

      .section-header.accent {
        background: linear-gradient(180deg, rgba(109,141,255,.16), rgba(109,141,255,.06));
      }

      .section-header.warning {
        background: linear-gradient(180deg, rgba(255,184,107,.16), rgba(255,184,107,.06));
      }

      .section-title-wrap {
        min-width: 0;
      }

      .section-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
      }

      .section-subtitle {
        margin-top: 4px;
        font-size: 12px;
        color: var(--muted);
      }

      .section-meta {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: max-content;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        justify-content: end;
      }

      .pill {
        min-height: 22px;
        min-width: 50px;
        padding: 0 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        font-size: 11px;
      }

      .section-sort,
      .section-toggle,
      .section-menu,
      .bookmark-menu,
      .bookmark-shift {
        border: 1px solid var(--border);
        background: rgba(255,255,255,.03);
        color: var(--fg);
        border-radius: 999px;
        cursor: pointer;
        transition: transform .14s ease, filter .14s ease, background .14s ease;
      }

      .section-sort,
      .section-toggle,
      .section-menu,
      .bookmark-menu,
      .bookmark-shift {
        min-height: 28px;
        min-width: 28px;
        padding: 0 10px;
      }

      .section-sort,
      .section-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--muted);
        min-width: 52px;
        padding: 0 8px;
        white-space: nowrap;
        text-align: center;
        line-height: 1;
        flex-shrink: 0;
      }

      .section-header.is-draggable {
        cursor: grab;
      }

      .section-header.is-dragging {
        opacity: .62;
      }

      .section-drop-target {
        box-shadow: inset 0 0 0 1px rgba(109,141,255,.34);
      }

      .section-list {
        display: grid;
        gap: 8px;
        padding: 0 10px 10px;
      }

      .section-list.collapsed {
        display: none;
      }

      .bookmark {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        padding: 12px;
        border-radius: var(--radius-lg);
        border: 1px solid rgba(255,255,255,.05);
        background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.015));
        transform-origin: top center;
        animation: fadeUp .18s ease-out;
        cursor: pointer;
      }

      .bookmark.is-missing {
        border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
        background: linear-gradient(180deg, rgba(255, 98, 98, .06), rgba(255,255,255,.015));
      }

      .bookmark.is-pinned {
        box-shadow: inset 0 0 0 1px rgba(109,141,255,.16);
      }

      .bookmark.is-highlighted {
        border-color: rgba(62, 207, 142, .42);
        box-shadow: inset 0 0 0 1px rgba(62, 207, 142, .22), 0 0 0 1px rgba(62, 207, 142, .12);
        animation: bookmarkPulse 1.4s ease-out;
      }

      .bookmark-main {
        min-width: 0;
      }

      .bookmark.compact {
        padding: 10px 12px;
      }

      .bookmark.compact .bookmark-path {
        margin-top: 4px;
      }

      .bookmark.compact .bookmark-line {
        margin-top: 4px;
      }

      .bookmark.compact .bookmark-meta {
        margin-top: 6px;
      }

      .bookmark.compact .bookmark-tags {
        margin-top: 4px;
      }

      .bookmark-head {
        min-width: 0;
      }

      .bookmark-label {
        display: block;
        font-weight: 700;
        letter-spacing: -.01em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bookmark-label-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .rename-editor {
        display: grid;
        gap: 8px;
      }

      .rename-input {
        width: 100%;
        min-height: 34px;
        padding: 0 10px;
        border-radius: 10px;
        border: 1px solid color-mix(in srgb, var(--focus) 42%, var(--border));
        background: color-mix(in srgb, var(--panel-2) 88%, black 12%);
        color: var(--fg);
      }

      .rename-input:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 2px;
      }

      .rename-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .rename-button {
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        transition: transform .14s ease, filter .14s ease, border-color .14s ease;
      }

      .rename-button.primary {
        color: var(--accent-fg);
        background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 90%, white 10%), color-mix(in srgb, var(--accent) 82%, black 18%));
        border-color: transparent;
      }

      .rename-button:hover {
        transform: translateY(-1px);
        filter: brightness(1.04);
      }

      .bookmark-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        min-height: 20px;
      }

      .type-badge,
      .status-badge,
      .pin-badge {
        min-height: 20px;
        padding: 0 8px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        border: 1px solid var(--border);
      }

      .type-badge.folder { color: #86d1ff; }
      .type-badge.file { color: #9db2ff; }
      .type-badge.line { color: #9bf0c9; }

      .status-badge.missing {
        color: #ff9c9c;
        border-color: rgba(255,156,156,.28);
        background: rgba(255,80,80,.08);
      }

      .pin-badge {
        color: #ffd56a;
        border-color: rgba(255,213,106,.26);
        background: rgba(255,213,106,.08);
      }

      .bookmark-path {
        margin-top: 6px;
        color: var(--muted);
        word-break: break-word;
      }

      .bookmark-line {
        margin-top: 6px;
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
      }

      .bookmark-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }

      .meta {
        font-size: 12px;
      }

      .bookmark-actions {
        display: flex;
        align-items: flex-start;
        gap: 6px;
      }

      .bookmark-menu,
      .bookmark-shift,
      .section-menu {
        min-height: 30px;
        min-width: 30px;
        padding: 0 10px;
      }

      .bookmark-shift {
        font-size: 14px;
        line-height: 1;
      }

      .context-menu {
        position: fixed;
        z-index: 100;
        min-width: 144px;
        padding: 6px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 90%, black 10%);
        box-shadow: var(--shadow-lg);
        display: none;
      }

      .context-menu.visible {
        display: grid;
        animation: fadeUp .12s ease-out;
      }

      .context-menu button {
        min-height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--fg);
        text-align: left;
        cursor: pointer;
      }

      .context-menu button:hover {
        background: rgba(255,255,255,.06);
      }

      .context-menu button.danger {
        color: var(--danger);
      }

      .inline-menu {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        z-index: 30;
        min-width: 240px;
        padding: 6px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 90%, black 10%);
        box-shadow: var(--shadow-lg);
        display: none;
      }

      .inline-menu.visible {
        display: grid;
        animation: fadeUp .12s ease-out;
      }

      .inline-menu button {
        min-height: 34px;
        padding: 0 12px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--fg);
        text-align: left;
        cursor: pointer;
      }

      .inline-menu button:hover {
        background: rgba(255,255,255,.06);
      }

      .inline-form {
        display: none;
        gap: 8px;
        padding: 10px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-2) 88%, black 12%);
      }

      .inline-form.visible {
        display: grid;
        animation: fadeUp .12s ease-out;
      }

      .inline-form-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .overlay-menu {
        position: fixed;
        z-index: 110;
        min-width: 220px;
        padding: 6px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 90%, black 10%);
        box-shadow: var(--shadow-lg);
        display: none;
      }

      .overlay-menu.visible {
        display: grid;
        animation: fadeUp .12s ease-out;
      }

      .overlay-menu button {
        min-height: 34px;
        padding: 0 12px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--fg);
        text-align: left;
        cursor: pointer;
      }

      .overlay-menu button:hover {
        background: rgba(255,255,255,.06);
      }

      .overlay-menu button.is-active {
        background: rgba(109,141,255,.12);
      }

      .footer-tip {
        text-align: center;
        font-size: 12px;
        padding-bottom: 8px;
      }

      @media (max-width: 320px) {
        .hero-top {
          grid-template-columns: 1fr;
        }

        .title-actions {
          justify-self: start;
        }

        .toolbar-actions {
          grid-template-columns: 1fr;
        }

        .toolbar-primary,
        #btn-clean-missing {
          width: 100%;
        }

        .bookmark {
          grid-template-columns: 1fr;
          gap: 8px;
        }

        .bookmark-actions {
          justify-content: flex-end;
          padding-top: 2px;
        }

        .bookmark-main {
          min-width: 0;
        }

        .bookmark-label {
          white-space: normal;
          word-break: break-word;
          line-height: 1.25;
        }

        .bookmark-tags {
          gap: 4px;
        }

        .type-badge,
        .status-badge,
        .pin-badge {
          padding: 0 6px;
          font-size: 10px;
        }

        .bookmark-menu {
          min-width: 28px;
          min-height: 28px;
          padding: 0 8px;
        }
      }

      @keyframes fadeUp {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes bookmarkPulse {
        0% {
          transform: translateY(0) scale(0.995);
          box-shadow: inset 0 0 0 1px rgba(62, 207, 142, .28), 0 0 0 0 rgba(62, 207, 142, .24);
        }
        35% {
          transform: translateY(-1px) scale(1);
          box-shadow: inset 0 0 0 1px rgba(62, 207, 142, .36), 0 0 0 8px rgba(62, 207, 142, 0);
        }
        100% {
          transform: translateY(0) scale(1);
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <section class="hero">
        <div class="hero-top">
          <div class="hero-copy">
            <div class="eyebrow">JumpJump Workspace</div>
            <h1 id="hero-title">仓库导航工作台</h1>
          </div>
          <div class="title-actions">
            <button id="locale-toggle" class="locale-toggle">English</button>
            <span class="pill workspace-pill" id="workspace-name">-</span>
          </div>
        </div>
        <div id="hero-subtitle" class="subtitle">把最常跳的目录、文件和代码位置整理成一套可点击、可筛选、可维护的捷径系统。</div>
        <div class="stats">
          <div class="stat"><div id="label-total" class="stat-label">总书签</div><div class="stat-value" id="stat-total">0</div></div>
          <div class="stat"><div id="label-pinned" class="stat-label">置顶</div><div class="stat-value" id="stat-pinned">0</div></div>
          <div class="stat"><div id="label-missing" class="stat-label">失效路径</div><div class="stat-value" id="stat-missing">0</div></div>
        </div>
      </section>

      <section class="toolbar-card">
        <div class="toolbar-actions">
          <div class="toolbar-primary">
            <button id="btn-add-menu" class="action subtle has-caret">添加 / Add</button>
            <div id="add-menu" class="inline-menu">
              <button data-action="addCurrentFile">收藏当前文件</button>
              <button data-action="addCurrentLine">收藏当前代码位置</button>
              <button data-action="addCurrentFolder">收藏当前文件所在目录</button>
              <button data-action="createGroup">新建分组</button>
            </div>
          </div>
          <button id="btn-clean-missing" class="action subtle" data-action="removeMissing">清理失效书签</button>
        </div>

        <div id="create-group-form" class="inline-form">
          <input id="create-group-input" class="rename-input" type="text" placeholder="输入分组名称" />
          <div class="inline-form-actions">
            <button id="create-group-cancel" class="rename-button">取消</button>
            <button id="create-group-save" class="rename-button primary">保存</button>
          </div>
        </div>

        <div class="search-row">
          <input id="search-input" class="search-input" type="search" placeholder="搜索名称、路径、分组" />
          <div class="chips">
            <button class="chip active" data-filter="all">全部</button>
            <button class="chip" data-filter="pinned">置顶</button>
            <button class="chip" data-filter="folder">目录</button>
            <button class="chip" data-filter="file">文件</button>
            <button class="chip" data-filter="line">代码位置</button>
            <button class="chip" data-filter="missing">失效</button>
          </div>
        </div>
      </section>

      <section id="empty-state" class="empty">
        <h2 id="empty-title" class="empty-title">先搭一套你自己的导航地图</h2>
        <div id="empty-copy" class="empty-copy">首批建议先收三类入口：项目根目录下的常用目录、当前正在看的核心文件、以及常调试的具体代码位置。</div>
        <div class="action-grid">
          <button id="empty-add-file" class="action" data-action="addCurrentFile">收藏当前文件</button>
          <button id="empty-add-line" class="action secondary" data-action="addCurrentLine">收藏当前代码位置</button>
        </div>
        <div id="empty-checklist" class="empty-checklist">
          <div>1. 收藏 cmd/、internal/、scripts/ 这类高频目录</div>
          <div>2. 把路由、启动入口、服务编排文件置顶</div>
          <div>3. 把常调试的断点位置收进“最近访问”循环里</div>
        </div>
      </section>

      <section id="sections" class="sections"></section>

      <div id="context-menu" class="context-menu">
        <button data-menu-action="open">打开</button>
        <button data-menu-action="pin">置顶</button>
        <button data-menu-action="move-group">移动到分组</button>
        <button data-menu-action="rename">改名</button>
        <button class="danger" data-menu-action="delete">删掉</button>
      </div>

      <div id="group-menu" class="context-menu">
        <button data-group-menu-action="create">新建分组</button>
        <button data-group-menu-action="rename">重命名分组</button>
        <button class="danger" data-group-menu-action="delete">删除分组</button>
      </div>

      <div id="picker-menu" class="overlay-menu"></div>

      <div id="footer-tip" class="footer-tip">提示：置顶负责“长期常用”，最近访问负责“当前上下文”，分组负责“结构化管理”。</div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const persisted = vscode.getState() || { query: "", filter: "all" };
      const state = {
        data: null,
        query: persisted.query || "",
        filter: persisted.filter || "all",
        contextMenu: { visible: false, bookmarkId: null, x: 0, y: 0 },
        groupMenu: { visible: false, groupId: null, x: 0, y: 0 },
        pickerMenu: { visible: false, mode: null, x: 0, y: 0, bookmarkId: null, groupId: null },
        editingBookmarkId: null,
        editingValue: "",
        draggingGroupId: null,
        groupFormVisible: false,
        groupFormMode: "create",
        editingGroupId: null
      };

      const sectionsEl = document.getElementById("sections");
      const emptyEl = document.getElementById("empty-state");
      const searchInput = document.getElementById("search-input");
      const chips = Array.from(document.querySelectorAll(".chip"));
      const contextMenuEl = document.getElementById("context-menu");
      const groupMenuEl = document.getElementById("group-menu");
      const pickerMenuEl = document.getElementById("picker-menu");
      const addMenuEl = document.getElementById("add-menu");
      const createGroupFormEl = document.getElementById("create-group-form");
      const createGroupInputEl = document.getElementById("create-group-input");
      const createGroupSaveEl = document.getElementById("create-group-save");
      const createGroupCancelEl = document.getElementById("create-group-cancel");
      const localeToggleEl = document.getElementById("locale-toggle");
      searchInput.value = state.query;

      const i18n = {
        zh: {
          languageToggle: "English",
          heroTitle: "仓库导航工作台",
          heroSubtitle: "把最常跳的目录、文件和代码位置整理成一套可点击、可筛选、可维护的捷径系统。",
          total: "总书签",
          pinned: "置顶",
          missing: "失效路径",
          addFile: "收藏当前文件",
          addLine: "收藏当前代码位置",
          addFolder: "收藏当前文件所在目录",
          createGroup: "新建分组",
          groupNamePlaceholder: "输入分组名称",
          addMenu: "添加",
          cleanMissing: "清理失效书签",
          searchPlaceholder: "搜索名称、路径、分组",
          searchPlaceholderPinned: "搜索置顶名称、路径、分组",
          searchPlaceholderFolder: "搜索目录名称、路径、分组",
          searchPlaceholderFile: "搜索文件名称、路径、分组",
          searchPlaceholderLine: "搜索代码位置名称、路径、分组",
          searchPlaceholderMissing: "搜索失效书签名称、路径、分组",
          all: "全部",
          pinnedFilter: "置顶",
          folder: "目录",
          file: "文件",
          line: "代码位置",
          missingFilter: "失效",
          emptyTitle: "先搭一套你自己的导航地图",
          emptyCopy: "首批建议先收三类入口：项目根目录下的常用目录、当前正在看的核心文件、以及常调试的具体代码位置。",
          emptyChecklist: [
            "1. 收藏 cmd/、internal/、scripts/ 这类高频目录",
            "2. 把路由、启动入口、服务编排文件置顶",
            "3. 把常调试的断点位置收进“最近访问”循环里"
          ],
          footerTip: "提示：置顶负责“长期常用”，最近访问负责“当前上下文”，分组负责“结构化管理”。",
          open: "打开",
          pin: "置顶",
          unpin: "取消置顶",
          moveGroup: "移动到分组",
          rename: "改名",
          renameGroup: "重命名分组",
          deleteGroup: "删除分组",
          sortSection: "排序",
          renamePlaceholder: "输入新的书签名称",
          save: "保存",
          cancel: "取消",
          delete: "删掉",
          typeFolder: "目录",
          typeFile: "文件",
          typeLine: "代码位置",
          missingBadge: "失效",
          pinnedBadge: "置顶",
          noResultsTitle: "没有匹配结果",
          noResultsCopy: "换个关键词，或者切到“全部 / 置顶 / 失效”看看。",
          itemSuffix: "项",
          expand: "展开",
          collapse: "收起",
          sortManual: "手动",
          sortLabel: "名称",
          sortCreatedAt: "添加时间",
          sortUpdatedAt: "修改时间",
          sortType: "类型",
          moveUp: "上移",
          moveDown: "下移",
          emptyGroup: "这个分组还没有书签。"
        },
        en: {
          languageToggle: "中文",
          heroTitle: "Repository Navigator",
          heroSubtitle: "Turn your most-used folders, files, and code locations into a clickable, filterable, maintainable shortcut system.",
          total: "Bookmarks",
          pinned: "Pinned",
          missing: "Missing",
          addFile: "Save Current File",
          addLine: "Save Current Location",
          addFolder: "Save Current Folder",
          createGroup: "Create Group",
          groupNamePlaceholder: "Enter a group name",
          addMenu: "Add",
          cleanMissing: "Clean Missing",
          searchPlaceholder: "Search label, path, or group",
          searchPlaceholderPinned: "Search pinned label, path, or group",
          searchPlaceholderFolder: "Search folder label, path, or group",
          searchPlaceholderFile: "Search file label, path, or group",
          searchPlaceholderLine: "Search code label, path, or group",
          searchPlaceholderMissing: "Search missing label, path, or group",
          all: "All",
          pinnedFilter: "Pinned",
          folder: "Folder",
          file: "File",
          line: "Code",
          missingFilter: "Missing",
          emptyTitle: "Build your navigation map first",
          emptyCopy: "Start with three kinds of shortcuts: high-traffic folders, core files you're viewing now, and the code locations you debug most often.",
          emptyChecklist: [
            "1. Save folders like cmd/, internal/, and scripts/",
            "2. Pin routes, startup files, and service entrypoints",
            "3. Let recent locations carry your current context"
          ],
          footerTip: "Tip: pinned items are long-term anchors, recent items hold current context, and groups keep things structured.",
          open: "Open",
          pin: "Pin",
          unpin: "Unpin",
          moveGroup: "Move to Group",
          rename: "Rename",
          renameGroup: "Rename Group",
          deleteGroup: "Delete Group",
          sortSection: "Sort",
          renamePlaceholder: "Enter a new bookmark label",
          save: "Save",
          cancel: "Cancel",
          delete: "Delete",
          typeFolder: "Folder",
          typeFile: "File",
          typeLine: "Code",
          missingBadge: "Missing",
          pinnedBadge: "Pinned",
          noResultsTitle: "No matching results",
          noResultsCopy: "Try another keyword or switch to All / Pinned / Missing.",
          itemSuffix: "items",
          expand: "Expand",
          collapse: "Collapse",
          sortManual: "Manual",
          sortLabel: "Label",
          sortCreatedAt: "Created",
          sortUpdatedAt: "Updated",
          sortType: "Type",
          moveUp: "Up",
          moveDown: "Down",
          emptyGroup: "This group does not have any bookmarks yet."
        }
      };

      function persist() {
        vscode.setState({
          query: state.query,
          filter: state.filter
        });
      }

      function post(type, extra = {}) {
        vscode.postMessage({ type, ...extra });
      }

      function typeLabel(type) {
        const dict = i18n[state.data?.locale || "zh"];
        if (type === "folder") return dict.typeFolder;
        if (type === "file") return dict.typeFile;
        return dict.typeLine;
      }

      function currentSearchPlaceholder(locale, filter) {
        const dict = i18n[locale];
        if (filter === "pinned") return dict.searchPlaceholderPinned;
        if (filter === "folder") return dict.searchPlaceholderFolder;
        if (filter === "file") return dict.searchPlaceholderFile;
        if (filter === "line") return dict.searchPlaceholderLine;
        if (filter === "missing") return dict.searchPlaceholderMissing;
        return dict.searchPlaceholder;
      }

      function matches(item, section) {
        const q = state.query.trim().toLowerCase();
        const sectionMatched = !!q && section.title.toLowerCase().includes(q);
        const byQuery = !q || sectionMatched || item.label.toLowerCase().includes(q) || item.path.toLowerCase().includes(q);
        if (!byQuery) return false;
        if (state.filter === "all") return true;
        if (state.filter === "missing") return item.missing;
        if (state.filter === "pinned") return item.pinned;
        return item.type === state.filter;
      }

      function escapeHtml(text) {
        return text
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function sortLabel(dict, sortBy) {
        if (sortBy === "label") return dict.sortLabel;
        if (sortBy === "createdAt") return dict.sortCreatedAt;
        if (sortBy === "updatedAt") return dict.sortUpdatedAt;
        if (sortBy === "type") return dict.sortType;
        return dict.sortManual;
      }

      function renderSection(section) {
        const dict = i18n[state.data?.locale || "zh"];
        const collapsed = section.collapsed === true;
        const items = section.items.filter((item) => matches(item, section));
        if (items.length === 0 && (state.query || state.filter !== "all")) return "";
        const compact = section.density === "compact";
        const manualSort = section.sortBy === "manual";

        const toneClass = section.tone === "accent" ? "accent" : section.tone === "warning" ? "warning" : "";
        const rows = items.map((item) => {
          const pathText = item.path;
          const lineText = item.type === "line" && item.line ? "第 " + item.line + " 行" : "";
          const isEditing = state.editingBookmarkId === item.id;
          const labelArea = isEditing
            ? \`
                <div class="rename-editor">
                  <input
                    class="rename-input"
                    data-rename-input="\${item.id}"
                    value="\${escapeHtml(state.editingValue)}"
                    placeholder="\${escapeHtml(dict.renamePlaceholder)}"
                  />
                  <div class="rename-actions">
                    <button class="rename-button primary" data-inline-action="save-rename" data-bookmark-id="\${item.id}">\${dict.save}</button>
                    <button class="rename-button" data-inline-action="cancel-rename" data-bookmark-id="\${item.id}">\${dict.cancel}</button>
                  </div>
                </div>
              \`
            : '<div class="bookmark-label">' + escapeHtml(item.label) + "</div>";
          return \`
            <article class="bookmark \${compact ? "compact" : ""} \${item.missing ? "is-missing" : ""} \${item.pinned ? "is-pinned" : ""} \${state.data.highlightedBookmarkId === item.id ? "is-highlighted" : ""}" data-open="\${item.id}" data-bookmark-id="\${item.id}">
              <div class="bookmark-main">
                <div class="bookmark-head">
                  <div class="bookmark-label-row">\${labelArea}</div>
                </div>
                <div class="bookmark-tags">
                  <span class="type-badge \${item.type}">\${typeLabel(item.type)}</span>
                  \${item.pinned ? '<span class="pin-badge">' + dict.pinnedBadge + '</span>' : ""}
                  \${item.missing ? '<span class="status-badge missing">' + dict.missingBadge + '</span>' : ""}
                </div>
                <div class="bookmark-path">\${escapeHtml(pathText)}</div>
                \${lineText ? '<div class="bookmark-line">' + escapeHtml(lineText) + '</div>' : ""}
              </div>
              <div class="bookmark-actions">
                \${manualSort ? '<button class="bookmark-shift" title="' + dict.moveUp + '" data-move-bookmark="up" data-bookmark-id="' + item.id + '">↑</button>' : ""}
                \${manualSort ? '<button class="bookmark-shift" title="' + dict.moveDown + '" data-move-bookmark="down" data-bookmark-id="' + item.id + '">↓</button>' : ""}
                <button class="bookmark-menu" title="More" data-menu="\${item.id}">···</button>
              </div>
            </article>
          \`;
        }).join("");

        return \`
          <section class="section \${state.draggingGroupId === section.groupId ? "section-drop-target" : ""}" data-section-group="\${section.groupId}">
            <div class="section-header \${toneClass} \${section.draggable ? "is-draggable" : ""}" \${section.draggable ? 'draggable="true" data-draggable-group="' + section.groupId + '"' : ""}>
              <div class="section-title-wrap">
                <div class="section-title">\${escapeHtml(section.title)}</div>
                \${section.subtitle ? '<div class="section-subtitle">' + escapeHtml(section.subtitle) + '</div>' : ""}
              </div>
              <div class="section-meta">
                <span class="pill">\${items.length} \${dict.itemSuffix}</span>
                <button class="section-sort" data-section-sort="\${section.groupId}">\${dict.sortSection}</button>
                \${section.collapsible ? '<button class="section-toggle" data-group-toggle="' + section.groupId + '" data-next-collapsed="' + String(!collapsed) + '">' + (collapsed ? dict.expand : dict.collapse) + '</button>' : ""}
                <button class="section-menu" data-group-menu="\${section.groupId}">···</button>
              </div>
            </div>
            <div class="section-list \${collapsed ? "collapsed" : ""}">
              \${rows || '<div class="empty-copy">' + escapeHtml(dict.emptyGroup || "") + "</div>"}
            </div>
          </section>
        \`;
      }

      function render() {
        const data = state.data;
        if (!data) return;

        renderChromeTexts(data.locale);
        document.getElementById("workspace-name").textContent = data.workspaceName;
        document.getElementById("stat-total").textContent = String(data.total);
        document.getElementById("stat-pinned").textContent = String(data.pinned);
        document.getElementById("stat-missing").textContent = String(data.missing);

        emptyEl.classList.toggle("visible", !data.hasItems);
        if (!data.hasItems) {
          sectionsEl.innerHTML = "";
          return;
        }

        const renderedSections = data.sections.map(renderSection).filter(Boolean).join("");
        if (!renderedSections) {
          const dict = i18n[data.locale];
          sectionsEl.innerHTML = '<section class="empty visible"><h2 class="empty-title">' + escapeHtml(dict.noResultsTitle) + '</h2><div class="empty-copy">' + escapeHtml(dict.noResultsCopy) + "</div></section>";
          return;
        }

        sectionsEl.innerHTML = renderedSections;
        renderContextMenu();
        renderGroupMenu();
        focusRenameInputIfNeeded();
      }

      function renderChromeTexts(locale) {
        const dict = i18n[locale];
        document.getElementById("hero-title").textContent = dict.heroTitle;
        document.getElementById("hero-subtitle").textContent = dict.heroSubtitle;
        document.getElementById("label-total").textContent = dict.total;
        document.getElementById("label-pinned").textContent = dict.pinned;
        document.getElementById("label-missing").textContent = dict.missing;
        document.getElementById("btn-add-menu").textContent = dict.addMenu;
        document.getElementById("btn-clean-missing").textContent = dict.cleanMissing;
        document.getElementById("empty-title").textContent = dict.emptyTitle;
        document.getElementById("empty-copy").textContent = dict.emptyCopy;
        document.getElementById("empty-add-file").textContent = dict.addFile;
        document.getElementById("empty-add-line").textContent = dict.addLine;
        document.getElementById("footer-tip").textContent = dict.footerTip;
        document.getElementById("search-input").placeholder = currentSearchPlaceholder(locale, state.filter);
        createGroupInputEl.placeholder = dict.groupNamePlaceholder;
        createGroupSaveEl.textContent = dict.save;
        createGroupCancelEl.textContent = dict.cancel;
        document.getElementById("locale-toggle").textContent = dict.languageToggle;
        document.getElementById("empty-checklist").innerHTML = dict.emptyChecklist.map((line) => '<div>' + escapeHtml(line) + "</div>").join("");

        const filterText = {
          all: dict.all,
          pinned: dict.pinnedFilter,
          folder: dict.folder,
          file: dict.file,
          line: dict.line,
          missing: dict.missingFilter
        };
        chips.forEach((chip) => {
          const filter = chip.dataset.filter;
          if (filter && filterText[filter]) {
            chip.textContent = filterText[filter];
          }
        });

        contextMenuEl.querySelector('[data-menu-action="open"]').textContent = dict.open;
        contextMenuEl.querySelector('[data-menu-action="move-group"]').textContent = dict.moveGroup;
        contextMenuEl.querySelector('[data-menu-action="rename"]').textContent = dict.rename;
        contextMenuEl.querySelector('[data-menu-action="delete"]').textContent = dict.delete;
        groupMenuEl.querySelector('[data-group-menu-action="create"]').textContent = dict.createGroup;
        groupMenuEl.querySelector('[data-group-menu-action="rename"]').textContent = dict.renameGroup;
        groupMenuEl.querySelector('[data-group-menu-action="delete"]').textContent = dict.deleteGroup;
        const addMenuButtons = addMenuEl.querySelectorAll("[data-action]");
        addMenuButtons.forEach((button) => {
          const action = button.dataset.action;
          if (action === "addCurrentFile") button.textContent = dict.addFile;
          if (action === "addCurrentLine") button.textContent = dict.addLine;
          if (action === "addCurrentFolder") button.textContent = dict.addFolder;
          if (action === "createGroup") button.textContent = dict.createGroup;
        });
      }

      function renderContextMenu() {
        if (!state.contextMenu.visible || !state.contextMenu.bookmarkId) {
          contextMenuEl.classList.remove("visible");
          return;
        }

        const bookmark = findBookmarkById(state.contextMenu.bookmarkId);
        if (!bookmark) {
          hideContextMenu();
          return;
        }

        contextMenuEl.style.left = state.contextMenu.x + "px";
        contextMenuEl.style.top = state.contextMenu.y + "px";
        contextMenuEl.classList.add("visible");
        const pinButton = contextMenuEl.querySelector('[data-menu-action="pin"]');
        if (pinButton) {
          const dict = i18n[state.data?.locale || "zh"];
          pinButton.textContent = bookmark.pinned ? dict.unpin : dict.pin;
        }
      }

      function renderGroupMenu() {
        if (!state.groupMenu.visible || !state.groupMenu.groupId) {
          groupMenuEl.classList.remove("visible");
          return;
        }
        const section = findSectionByGroupId(state.groupMenu.groupId);
        if (!section) {
          hideGroupMenu();
          return;
        }
        groupMenuEl.style.left = state.groupMenu.x + "px";
        groupMenuEl.style.top = state.groupMenu.y + "px";
        groupMenuEl.classList.add("visible");
        const renameButton = groupMenuEl.querySelector('[data-group-menu-action="rename"]');
        const deleteButton = groupMenuEl.querySelector('[data-group-menu-action="delete"]');
        if (renameButton) renameButton.style.display = section.system ? "none" : "block";
        if (deleteButton) deleteButton.style.display = section.system ? "none" : "block";
      }

      function findBookmarkById(id) {
        if (!state.data) return null;
        for (const section of state.data.sections) {
          const match = section.items.find((item) => item.id === id);
          if (match) return match;
        }
        return null;
      }

      function findSectionByGroupId(groupId) {
        if (!state.data) return null;
        return state.data.sections.find((section) => section.groupId === groupId) || null;
      }

      function hideContextMenu() {
        state.contextMenu.visible = false;
        state.contextMenu.bookmarkId = null;
        contextMenuEl.classList.remove("visible");
      }

      function hideGroupMenu() {
        state.groupMenu.visible = false;
        state.groupMenu.groupId = null;
        groupMenuEl.classList.remove("visible");
      }

      function hidePickerMenu() {
        state.pickerMenu.visible = false;
        state.pickerMenu.mode = null;
        state.pickerMenu.bookmarkId = null;
        state.pickerMenu.groupId = null;
        pickerMenuEl.classList.remove("visible");
      }

      function hideAddMenu() {
        addMenuEl.classList.remove("visible");
      }

      function showGroupForm(mode, groupId) {
        state.groupFormVisible = true;
        state.groupFormMode = mode;
        state.editingGroupId = groupId || null;
        createGroupFormEl.classList.add("visible");
        hideAddMenu();
        hideContextMenu();
        hideGroupMenu();
        hidePickerMenu();
        const section = groupId ? findSectionByGroupId(groupId) : null;
        createGroupInputEl.value = mode === "rename" && section ? section.title : "";
        createGroupInputEl.focus();
        createGroupInputEl.select();
      }

      function hideGroupForm() {
        state.groupFormVisible = false;
        state.groupFormMode = "create";
        state.editingGroupId = null;
        createGroupFormEl.classList.remove("visible");
        createGroupInputEl.value = "";
      }

      function saveGroupForm() {
        const value = createGroupInputEl.value.trim();
        if (!value) {
          hideGroupForm();
          return;
        }
        if (state.groupFormMode === "rename" && state.editingGroupId) {
          post("renameGroup", { groupId: state.editingGroupId, name: value });
        } else {
          post("createGroup", { name: value });
        }
        hideGroupForm();
      }

      function toggleAddMenu() {
        const nextVisible = !addMenuEl.classList.contains("visible");
        hideContextMenu();
        hideGroupMenu();
        hidePickerMenu();
        addMenuEl.classList.toggle("visible", nextVisible);
      }

      function startRename(bookmarkId) {
        const bookmark = findBookmarkById(bookmarkId);
        if (!bookmark) return;
        state.editingBookmarkId = bookmarkId;
        state.editingValue = bookmark.label;
        hideContextMenu();
        hideGroupMenu();
        hidePickerMenu();
        render();
      }

      function cancelRename() {
        state.editingBookmarkId = null;
        state.editingValue = "";
        render();
      }

      function saveRename(bookmarkId) {
        const nextLabel = state.editingValue.trim();
        if (!bookmarkId || !nextLabel) {
          cancelRename();
          return;
        }
        post("renameBookmark", { id: bookmarkId, label: nextLabel });
        state.editingBookmarkId = null;
        state.editingValue = "";
      }

      function focusRenameInputIfNeeded() {
        if (!state.editingBookmarkId) return;
        const input = document.querySelector('[data-rename-input="' + state.editingBookmarkId + '"]');
        if (!(input instanceof HTMLInputElement)) return;
        input.focus();
        input.select();
      }

      function findSectionIdForBookmark(bookmarkId) {
        if (!state.data) return null;
        for (const section of state.data.sections) {
          if (section.items.some((item) => item.id === bookmarkId)) {
            return section.groupId;
          }
        }
        return null;
      }

      function openSortPicker(groupId, anchorEl) {
        const section = findSectionByGroupId(groupId);
        if (!section || !(anchorEl instanceof HTMLElement)) return;
        const dict = i18n[state.data?.locale || "zh"];
        const rect = anchorEl.getBoundingClientRect();
        const options = [
          { sortBy: "manual", label: dict.sortManual },
          { sortBy: "label", label: dict.sortLabel },
          { sortBy: "createdAt", label: dict.sortCreatedAt },
          { sortBy: "updatedAt", label: dict.sortUpdatedAt },
          { sortBy: "type", label: dict.sortType }
        ];
        pickerMenuEl.innerHTML = options
          .map((option) =>
            '<button class="' +
            (section.sortBy === option.sortBy ? "is-active" : "") +
            '" data-picker-action="sort" data-group-id="' +
            groupId +
            '" data-sort-by="' +
            option.sortBy +
            '">' +
            escapeHtml(option.label) +
            "</button>"
          )
          .join("");
        state.pickerMenu.visible = true;
        state.pickerMenu.mode = "sort";
        state.pickerMenu.groupId = groupId;
        state.pickerMenu.bookmarkId = null;
        state.pickerMenu.x = Math.max(8, Math.min(rect.left, window.innerWidth - 240));
        state.pickerMenu.y = Math.min(rect.bottom + 6, window.innerHeight - 240);
        pickerMenuEl.style.left = state.pickerMenu.x + "px";
        pickerMenuEl.style.top = state.pickerMenu.y + "px";
        pickerMenuEl.classList.add("visible");
      }

      function openMoveGroupPicker(bookmarkId, anchorEl) {
        if (!(anchorEl instanceof HTMLElement) || !state.data) return;
        const currentGroupId = findSectionIdForBookmark(bookmarkId);
        const options = listMoveGroupTargets(state.data.sections, currentGroupId);
        if (options.length === 0) return;
        const rect = anchorEl.getBoundingClientRect();
        pickerMenuEl.innerHTML = options
          .map((section) =>
            '<button data-picker-action="move-group" data-bookmark-id="' +
            bookmarkId +
            '" data-group-id="' +
            section.groupId +
            '">' +
            escapeHtml(section.title) +
            "</button>"
          )
          .join("");
        state.pickerMenu.visible = true;
        state.pickerMenu.mode = "move-group";
        state.pickerMenu.bookmarkId = bookmarkId;
        state.pickerMenu.groupId = null;
        state.pickerMenu.x = Math.max(8, Math.min(rect.left, window.innerWidth - 240));
        state.pickerMenu.y = Math.min(rect.bottom + 6, window.innerHeight - 240);
        pickerMenuEl.style.left = state.pickerMenu.x + "px";
        pickerMenuEl.style.top = state.pickerMenu.y + "px";
        pickerMenuEl.classList.add("visible");
      }

      document.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const actionTarget = target.closest("[data-action]");
        const toggleTarget = target.closest("[data-group-toggle]");
        const menuTarget = target.closest("[data-menu]");
        const groupMenuTarget = target.closest("[data-group-menu]");
        const sectionSortTarget = target.closest("[data-section-sort]");
        const moveBookmarkTarget = target.closest("[data-move-bookmark]");
        const inlineActionTarget = target.closest("[data-inline-action]");
        const renameInputTarget = target.closest("[data-rename-input]");
        const addMenuTarget = target.closest("#btn-add-menu");
        const addMenuContentTarget = target.closest("#add-menu");
        const openTarget = target.closest("[data-open]");

        const action = actionTarget instanceof HTMLElement ? actionTarget.dataset.action : undefined;
        if (action) {
          if (action === "createGroup") {
            showGroupForm("create");
            return;
          }
          post(action);
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          hideAddMenu();
          return;
        }
        if (addMenuTarget instanceof HTMLElement) {
          toggleAddMenu();
          return;
        }
        if (addMenuContentTarget instanceof HTMLElement) {
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          return;
        }
        if (toggleTarget instanceof HTMLElement && toggleTarget.dataset.groupToggle) {
          post("toggleGroupCollapsed", {
            groupId: toggleTarget.dataset.groupToggle,
            collapsed: toggleTarget.dataset.nextCollapsed === "true"
          });
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          return;
        }
        if (sectionSortTarget instanceof HTMLElement && sectionSortTarget.dataset.sectionSort) {
          openSortPicker(sectionSortTarget.dataset.sectionSort, sectionSortTarget);
          hideContextMenu();
          hideGroupMenu();
          hideAddMenu();
          return;
        }
        if (moveBookmarkTarget instanceof HTMLElement && moveBookmarkTarget.dataset.bookmarkId && moveBookmarkTarget.dataset.moveBookmark) {
          post("moveBookmarkWithinGroup", {
            id: moveBookmarkTarget.dataset.bookmarkId,
            direction: moveBookmarkTarget.dataset.moveBookmark
          });
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          return;
        }
        if (menuTarget instanceof HTMLElement && menuTarget.dataset.menu) {
          const rect = menuTarget.getBoundingClientRect();
          hideAddMenu();
          hideGroupMenu();
          hidePickerMenu();
          state.contextMenu.visible = true;
          state.contextMenu.bookmarkId = menuTarget.dataset.menu;
          state.contextMenu.x = Math.max(8, Math.min(rect.left - 100, window.innerWidth - 160));
          state.contextMenu.y = Math.min(rect.bottom + 6, window.innerHeight - 160);
          renderContextMenu();
          return;
        }
        if (groupMenuTarget instanceof HTMLElement && groupMenuTarget.dataset.groupMenu) {
          const rect = groupMenuTarget.getBoundingClientRect();
          hideAddMenu();
          hideContextMenu();
          hidePickerMenu();
          state.groupMenu.visible = true;
          state.groupMenu.groupId = groupMenuTarget.dataset.groupMenu;
          state.groupMenu.x = Math.max(8, Math.min(rect.left - 100, window.innerWidth - 160));
          state.groupMenu.y = Math.min(rect.bottom + 6, window.innerHeight - 180);
          renderGroupMenu();
          return;
        }
        if (inlineActionTarget instanceof HTMLElement && inlineActionTarget.dataset.inlineAction) {
          const actionName = inlineActionTarget.dataset.inlineAction;
          const bookmarkId = inlineActionTarget.dataset.bookmarkId;
          if (actionName === "save-rename") {
            saveRename(bookmarkId);
            return;
          }
          if (actionName === "cancel-rename") {
            cancelRename();
            return;
          }
        }
        if (renameInputTarget instanceof HTMLElement) {
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          return;
        }
        if (openTarget instanceof HTMLElement && openTarget.dataset.open) {
          post("openBookmark", { id: openTarget.dataset.open });
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          hideAddMenu();
          return;
        }
        hideContextMenu();
        hideGroupMenu();
        hidePickerMenu();
        hideAddMenu();
      });

      document.body.addEventListener("contextmenu", (event) => {
        const bookmark = event.target instanceof HTMLElement ? event.target.closest("[data-bookmark-id]") : null;
        if (!(bookmark instanceof HTMLElement)) return;
        event.preventDefault();
        hideGroupMenu();
        hidePickerMenu();
        state.contextMenu.visible = true;
        state.contextMenu.bookmarkId = bookmark.dataset.bookmarkId;
        state.contextMenu.x = Math.min(event.clientX, window.innerWidth - 160);
        state.contextMenu.y = Math.min(event.clientY, window.innerHeight - 160);
        renderContextMenu();
      });

      contextMenuEl.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.menuAction;
        const bookmarkId = state.contextMenu.bookmarkId;
        if (!action || !bookmarkId) return;

        if (action === "open") post("openBookmark", { id: bookmarkId });
        if (action === "pin") post("togglePinned", { id: bookmarkId });
        if (action === "move-group") {
          openMoveGroupPicker(bookmarkId, target);
          hideContextMenu();
          return;
        }
        if (action === "rename") startRename(bookmarkId);
        if (action === "delete") post("deleteBookmark", { id: bookmarkId });
        hideContextMenu();
      });

      groupMenuEl.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.groupMenuAction;
        const groupId = state.groupMenu.groupId;
        if (!action || !groupId) return;
        if (action === "create") {
          showGroupForm("create");
          hideGroupMenu();
          return;
        }
        if (action === "rename") {
          showGroupForm("rename", groupId);
          hideGroupMenu();
          return;
        }
        if (action === "delete") post("deleteGroup", { groupId });
        hideGroupMenu();
      });

      pickerMenuEl.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.pickerAction;
        if (action === "sort" && target.dataset.groupId && target.dataset.sortBy) {
          post("setGroupSort", { groupId: target.dataset.groupId, sortBy: target.dataset.sortBy });
        }
        if (action === "move-group" && target.dataset.bookmarkId && target.dataset.groupId) {
          post("moveBookmarkToGroup", { id: target.dataset.bookmarkId, groupId: target.dataset.groupId });
        }
        hidePickerMenu();
      });

      sectionsEl.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.dataset.renameInput) return;
        state.editingValue = target.value;
      });

      sectionsEl.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const bookmarkId = target.dataset.renameInput;
        if (!bookmarkId) return;
        if (event.key === "Enter") {
          event.preventDefault();
          saveRename(bookmarkId);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRename();
        }
      });

      sectionsEl.addEventListener("dragstart", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const header = target.closest("[data-draggable-group]");
        if (!(header instanceof HTMLElement) || !header.dataset.draggableGroup) return;
        state.draggingGroupId = header.dataset.draggableGroup;
        header.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", state.draggingGroupId);
        }
      });

      sectionsEl.addEventListener("dragend", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement) {
          target.classList.remove("is-dragging");
        }
        state.draggingGroupId = null;
        render();
      });

      sectionsEl.addEventListener("dragover", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const section = target.closest("[data-section-group]");
        if (!(section instanceof HTMLElement)) return;
        const groupId = section.dataset.sectionGroup;
        if (!state.draggingGroupId || !groupId || groupId === "${UNGROUPED_GROUP_ID}" || groupId === state.draggingGroupId) return;
        event.preventDefault();
      });

      sectionsEl.addEventListener("drop", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const section = target.closest("[data-section-group]");
        if (!(section instanceof HTMLElement)) return;
        const targetGroupId = section.dataset.sectionGroup;
        const sourceGroupId = state.draggingGroupId;
        if (!sourceGroupId || !targetGroupId || targetGroupId === "${UNGROUPED_GROUP_ID}" || sourceGroupId === targetGroupId) return;
        event.preventDefault();
        const customGroupIds = state.data.sections
          .filter((entry) => entry.draggable)
          .map((entry) => entry.groupId);
        const nextOrder = customGroupIds.filter((id) => id !== sourceGroupId);
        const insertIndex = nextOrder.indexOf(targetGroupId);
        nextOrder.splice(insertIndex < 0 ? nextOrder.length : insertIndex, 0, sourceGroupId);
        post("reorderGroups", { groupIds: nextOrder });
        state.draggingGroupId = null;
      });

      searchInput.addEventListener("input", () => {
        state.query = searchInput.value;
        persist();
        render();
      });

      localeToggleEl.addEventListener("click", () => {
        hideAddMenu();
        hideGroupMenu();
        hidePickerMenu();
        post("toggleLanguage");
      });

      createGroupSaveEl.addEventListener("click", () => {
        saveGroupForm();
      });

      createGroupCancelEl.addEventListener("click", () => {
        hideGroupForm();
      });

      createGroupInputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveGroupForm();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          hideGroupForm();
        }
      });

      window.addEventListener("scroll", () => {
        hideContextMenu();
        hideGroupMenu();
        hidePickerMenu();
        hideAddMenu();
      }, true);

      chips.forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.filter === state.filter);
        chip.addEventListener("click", () => {
          state.filter = chip.dataset.filter || "all";
          chips.forEach((item) => item.classList.toggle("active", item === chip));
          searchInput.placeholder = currentSearchPlaceholder(state.data?.locale || "zh", state.filter);
          persist();
          render();
        });
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "state") {
          state.data = message.payload;
          render();
        }
      });

      post("ready");
    </script>
  </body>
</html>`;
  }
}

export class JumpJumpUnavailableSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "jumpjump.bookmarks";

  constructor(private readonly getLocale: () => "zh" | "en") {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const nonce = getNonce();
    const locale = this.getLocale();
    const title = locale === "en" ? "Open a repository first" : "需要先打开一个仓库";
    const body =
      locale === "en"
        ? "JumpJump currently supports a single-root workspace. Open one project folder in Cursor or VS Code, then come back to save your frequent files, folders, and code locations."
        : "JumpJump 当前只支持单一工作区。请先在 Cursor / VS Code 中打开一个具体项目目录，再回来收藏常用文件、目录和代码位置。";
    const tip =
      locale === "en"
        ? "Open the Go or Python project root directly instead of a multi-root workspace."
        : "建议直接打开 Go 或 Python 项目根目录，而不是多根工作区。";
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--vscode-sideBar-foreground);
        background:
          radial-gradient(circle at top right, rgba(95, 132, 255, 0.12), transparent 30%),
          var(--vscode-sideBar-background);
      }
      .card {
        padding: 16px;
        border-radius: 14px;
        border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127, 127, 127, 0.24));
        background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, white 12%);
      }
      .eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--vscode-descriptionForeground);
      }
      h1 {
        margin: 8px 0 6px;
        font-size: 18px;
      }
      p {
        margin: 0;
        color: var(--vscode-descriptionForeground);
      }
      .tip {
        margin-top: 14px;
        padding: 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
      }
    </style>
  </head>
  <body>
    <section class="card">
      <div class="eyebrow">JumpJump</div>
      <h1>${title}</h1>
      <p>${body}</p>
      <div class="tip">${tip}</div>
    </section>
  </body>
</html>`;
  }
}

function buildSidebarSection(
  locale: "zh" | "en",
  group: BookmarkGroup,
  items: (BookmarkItem & { missing: boolean; pinned?: boolean })[]
): SidebarSection {
  const mappedItems = sortSectionItems(items, group).map(mapSidebarItem);
  return {
    id: `group:${group.id}`,
    groupId: group.id,
    title: group.system ? (locale === "en" ? "Ungrouped" : "未分组") : group.name,
    subtitle: undefined,
    tone: items.some((item) => item.missing) ? "warning" : "accent",
    collapsible: true,
    collapsed: group.collapsed,
    sortBy: group.sortBy,
    system: group.system === true,
    draggable: group.system !== true,
    density: "comfortable",
    items: mappedItems
  };
}

function mapSidebarItem(item: BookmarkItem & { missing: boolean; pinned?: boolean }): SidebarBookmarkItem {
  return {
    id: item.id,
    label: item.label,
    path: item.path,
    type: item.type,
    line: item.line,
    missing: item.missing,
    pinned: item.pinned === true,
    lastOpenedAt: item.lastOpenedAt
  };
}

export function listMoveGroupTargets<T extends { groupId: string; title: string }>(
  sections: T[],
  currentGroupId: string | null
): T[] {
  return sections.filter((section) => section.groupId !== currentGroupId);
}

export function sortSectionItems(
  items: (BookmarkItem & { missing: boolean; pinned?: boolean })[],
  group: BookmarkGroup
): (BookmarkItem & { missing: boolean; pinned?: boolean })[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (group.sortBy !== "manual") {
      if (a.missing !== b.missing) {
        return a.missing ? 1 : -1;
      }
    }
    let result = 0;
    switch (group.sortBy) {
      case "label":
        result = a.label.localeCompare(b.label, "zh-Hans-CN");
        break;
      case "createdAt":
        result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "updatedAt":
        result = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case "type":
        result = a.type.localeCompare(b.type, "en");
        if (result === 0) {
          result = a.label.localeCompare(b.label, "zh-Hans-CN");
        }
        break;
      case "manual":
      default:
        result = a.manualOrder - b.manualOrder;
        if (result === 0) {
          result = a.createdAt.localeCompare(b.createdAt);
        }
        break;
    }
    return group.sortDirection === "desc" ? -result : result;
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 16 }, () => alphabet.charAt(Math.floor(Math.random() * alphabet.length))).join("");
}
