// Copyright 2026 Xinwei
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs/promises";
import * as vscode from "vscode";
import { BookmarkGroup, BookmarkItem, BookmarkSortBy } from "../types";
import { BookmarkStore } from "../bookmarks/store";
import { UNGROUPED_GROUP_ID } from "../bookmarks/schema";
import { sortSectionItems } from "./helpers";

type ThemeMode = "system" | "dark" | "light" | "aurora" | "coffee" | "sunlit" | "clean" | "purple" | "contrast";
const FEEDBACK_URL = "https://github.com/SivanCola/JumpJump/issues";

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
  compactMode: boolean;
  themeMode: ThemeMode;
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
  | { type: "toggleCompactMode" }
  | { type: "setThemeMode"; themeMode: ThemeMode }
  | { type: "openFeedback" }
  | { type: "addCurrentFile" }
  | { type: "addCurrentLine" }
  | { type: "addCurrentFolder" }
  | { type: "createGroup"; name?: string }
  | { type: "renameGroup"; groupId: string; name?: string }
  | { type: "deleteGroup"; groupId: string }
  | { type: "setGroupSort"; groupId: string; sortBy: BookmarkSortBy }
  | { type: "toggleGroupCollapsed"; groupId: string; collapsed: boolean }
  | { type: "reorderGroups"; groupIds: string[] }
  | { type: "reorderBookmarks"; groupId: string; itemIds: string[] }
  | { type: "moveBookmarkToGroupAndReorder"; id: string; groupId: string; itemIds: string[] }
  | { type: "removeMissing" }
  | { type: "openBookmark"; id: string }
  | { type: "renameBookmark"; id: string; label?: string }
  | { type: "deleteBookmark"; id: string }
  | { type: "togglePinned"; id: string }
  | { type: "moveBookmarkToGroup"; id: string; groupId?: string }
  | { type: "moveBookmarkWithinGroup"; id: string; direction: "up" | "down" };

function isThemeMode(value: unknown): value is ThemeMode {
  return (
    value === "system" ||
    value === "dark" ||
    value === "light" ||
    value === "aurora" ||
    value === "coffee" ||
    value === "sunlit" ||
    value === "clean" ||
    value === "purple" ||
    value === "contrast"
  );
}

export class JumpJumpSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "jumpjump.bookmarks";

  private view?: vscode.WebviewView;
  private highlightedBookmarkId?: string;
  private highlightTimer?: NodeJS.Timeout;

  constructor(
    private readonly extensionUri: vscode.Uri,
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
      reorderBookmarks: (groupId: string, itemIds: string[]) => Promise<void>;
      moveBookmarkToGroupAndReorder: (bookmark: BookmarkItem, groupId: string, itemIds: string[]) => Promise<void>;
      removeMissing: () => Promise<void>;
      togglePinned: (bookmark: BookmarkItem) => Promise<void>;
      moveBookmarkToGroup: (bookmark: BookmarkItem, groupId?: string) => Promise<void>;
      moveBookmarkWithinGroup: (bookmark: BookmarkItem, direction: "up" | "down") => Promise<void>;
      openBookmark: (bookmark: BookmarkItem) => Promise<void>;
      renameBookmark: (bookmark: BookmarkItem, label?: string) => Promise<void>;
      deleteBookmark: (bookmark: BookmarkItem) => Promise<void>;
    },
    private readonly getLocale: () => "zh" | "en",
    private readonly setLocale: (locale: "zh" | "en") => Promise<void>,
    private readonly getCompactMode: () => boolean,
    private readonly setCompactMode: (compactMode: boolean) => Promise<void>,
    private readonly getThemeMode: () => ThemeMode,
    private readonly setThemeMode: (themeMode: ThemeMode) => Promise<void>
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.onDidReceiveMessage(async (message: SidebarMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
        await this.refresh().catch(() => undefined);
      }
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
      case "toggleCompactMode":
        await this.setCompactMode(!this.getCompactMode());
        await this.refresh();
        return;
      case "setThemeMode":
        if (isThemeMode(message.themeMode)) {
          await this.setThemeMode(message.themeMode);
        }
        await this.refresh();
        return;
      case "openFeedback":
        await vscode.env.openExternal(vscode.Uri.parse(FEEDBACK_URL));
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
      case "reorderBookmarks":
        await this.commandHandlers.reorderBookmarks(message.groupId, message.itemIds);
        return;
      case "moveBookmarkToGroupAndReorder": {
        const bookmark = await this.findBookmark(message.id);
        if (bookmark) {
          await this.commandHandlers.moveBookmarkToGroupAndReorder(bookmark, message.groupId, message.itemIds);
        }
        return;
      }
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
      compactMode: this.getCompactMode(),
      themeMode: this.getThemeMode(),
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
        --page-glow-1: rgba(80, 115, 255, 0.16);
        --page-glow-2: rgba(33, 202, 255, 0.08);
        --hero-gradient-start: rgba(102, 125, 255, 0.22);
        --hero-gradient-end: rgba(12, 14, 27, 0.14);
        --hero-sheen-start: rgba(255,255,255,0.05);
        --hero-sheen-end: rgba(255,255,255,0.01);
        --hero-orb: rgba(62, 207, 142, 0.18);
        --toolbar-gradient-start: rgba(109,141,255,.16);
        --toolbar-gradient-mid: rgba(109,141,255,.05);
        --toolbar-gradient-end: rgba(255,255,255,.02);
        --toolbar-glow: rgba(109, 141, 255, 0.14);
        --toolbar-glow-secondary: rgba(62, 207, 142, 0.06);
        --badge-folder-fg: #86d1ff;
        --badge-folder-bg: rgba(82, 184, 255, .12);
        --badge-folder-border: rgba(134, 209, 255, .34);
        --badge-file-fg: #9db2ff;
        --badge-file-bg: rgba(125, 146, 255, .12);
        --badge-file-border: rgba(157, 178, 255, .34);
        --badge-line-fg: #9bf0c9;
        --badge-line-bg: rgba(62, 207, 142, .12);
        --badge-line-border: rgba(155, 240, 201, .34);
        --badge-pin-fg: #ffd166;
        --badge-pin-bg: rgba(255, 209, 102, .12);
        --badge-pin-border: rgba(255, 209, 102, .36);
        --badge-missing-fg: #ff9c9c;
        --badge-missing-bg: rgba(255, 80, 80, .1);
        --badge-missing-border: rgba(255, 156, 156, .34);
        --shadow-lg: 0 18px 40px rgba(0, 0, 0, 0.22);
        --shadow-md: 0 10px 24px rgba(0, 0, 0, 0.16);
        --sidebar-min-width: 340px;
        --radius-xl: 18px;
        --radius-lg: 14px;
        --radius-md: 12px;
        --radius-sm: 10px;
      }

      * { box-sizing: border-box; }
      html {
        min-height: 100%;
        scroll-behavior: smooth;
        scrollbar-gutter: stable;
      }
      body {
        margin: 0;
        color: var(--fg);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
        min-height: 100vh;
        overflow-y: auto;
        overflow-x: auto;
        min-width: var(--sidebar-min-width);
        background-color: var(--bg);
        background-image:
          radial-gradient(circle at top right, var(--page-glow-1), transparent 34%),
          radial-gradient(circle at top left, var(--page-glow-2), transparent 30%),
          linear-gradient(180deg, color-mix(in srgb, var(--bg) 82%, black 18%), var(--bg));
        background-repeat: no-repeat;
        background-size: 100% 560px, 100% 460px, 100% 680px;
        background-position: top right, top left, top left;
      }

      body.theme-dark {
        color-scheme: dark;
        --bg: #141520;
        --panel: #202234;
        --panel-2: #191b2a;
        --panel-3: #11131f;
        --border: rgba(213, 219, 255, .16);
        --fg: #edf1ff;
        --muted: #aab3cf;
        --accent: #7d92ff;
        --accent-soft: rgba(125, 146, 255, .18);
        --accent-fg: #ffffff;
        --danger: #ff7aa7;
        --focus: #8da0ff;
        --page-glow-1: rgba(125, 146, 255, .18);
        --page-glow-2: rgba(62, 207, 142, .08);
        --hero-gradient-start: rgba(125, 146, 255, .22);
        --hero-gradient-end: rgba(18, 20, 32, .18);
        --hero-orb: rgba(62, 207, 142, .16);
        --toolbar-gradient-start: rgba(125, 146, 255, .15);
        --toolbar-gradient-mid: rgba(125, 146, 255, .05);
        --toolbar-glow: rgba(125, 146, 255, .12);
        --toolbar-glow-secondary: rgba(62, 207, 142, .06);
        --badge-folder-fg: #8fd8ff;
        --badge-folder-bg: rgba(82, 184, 255, .13);
        --badge-folder-border: rgba(143, 216, 255, .36);
        --badge-file-fg: #aebcff;
        --badge-file-bg: rgba(125, 146, 255, .13);
        --badge-file-border: rgba(174, 188, 255, .36);
        --badge-line-fg: #8ff0c6;
        --badge-line-bg: rgba(62, 207, 142, .13);
        --badge-line-border: rgba(143, 240, 198, .36);
        --badge-pin-fg: #ffd166;
        --badge-pin-bg: rgba(255, 209, 102, .13);
        --badge-pin-border: rgba(255, 209, 102, .38);
        --badge-missing-fg: #ff9cbb;
        --badge-missing-bg: rgba(255, 122, 167, .12);
        --badge-missing-border: rgba(255, 156, 187, .36);
        --shadow-lg: 0 18px 40px rgba(0, 0, 0, .34);
        --shadow-md: 0 10px 24px rgba(0, 0, 0, .24);
      }

      body.theme-light {
        color-scheme: light;
        --bg: #f5f7fb;
        --panel: #ffffff;
        --panel-2: #f0f3fa;
        --panel-3: #e6ebf5;
        --border: rgba(53, 65, 101, .18);
        --fg: #20263a;
        --muted: #65708a;
        --accent: #5269d8;
        --accent-soft: rgba(82, 105, 216, .14);
        --accent-fg: #ffffff;
        --danger: #c93568;
        --focus: #5269d8;
        --page-glow-1: rgba(82, 105, 216, .13);
        --page-glow-2: rgba(32, 148, 120, .07);
        --hero-gradient-start: rgba(82, 105, 216, .14);
        --hero-gradient-end: rgba(255,255,255,.72);
        --hero-sheen-start: rgba(255,255,255,.86);
        --hero-sheen-end: rgba(255,255,255,.58);
        --hero-orb: rgba(82, 105, 216, .12);
        --toolbar-gradient-start: rgba(82,105,216,.12);
        --toolbar-gradient-mid: rgba(255,255,255,.72);
        --toolbar-gradient-end: rgba(255,255,255,.52);
        --toolbar-glow: rgba(82,105,216,.12);
        --toolbar-glow-secondary: rgba(32,148,120,.05);
        --badge-folder-fg: #075985;
        --badge-folder-bg: rgba(14, 116, 144, .1);
        --badge-folder-border: rgba(14, 116, 144, .28);
        --badge-file-fg: #3f51b5;
        --badge-file-bg: rgba(63, 81, 181, .1);
        --badge-file-border: rgba(63, 81, 181, .28);
        --badge-line-fg: #047857;
        --badge-line-bg: rgba(4, 120, 87, .1);
        --badge-line-border: rgba(4, 120, 87, .28);
        --badge-pin-fg: #8a5a00;
        --badge-pin-bg: rgba(180, 111, 0, .13);
        --badge-pin-border: rgba(180, 111, 0, .3);
        --badge-missing-fg: #b4232f;
        --badge-missing-bg: rgba(180, 35, 47, .1);
        --badge-missing-border: rgba(180, 35, 47, .3);
        --shadow-lg: 0 18px 40px rgba(41, 49, 78, .16);
        --shadow-md: 0 10px 24px rgba(41, 49, 78, .11);
      }

      body.theme-aurora {
        color-scheme: dark;
        --bg: #101827;
        --panel: #1b2638;
        --panel-2: #151f30;
        --panel-3: #0d1421;
        --border: rgba(216, 222, 233, .17);
        --fg: #eceff4;
        --muted: #a9b7cc;
        --accent: #88c0d0;
        --accent-soft: rgba(136, 192, 208, .18);
        --accent-fg: #0d1421;
        --success: #a3be8c;
        --warning: #ebcb8b;
        --danger: #bf616a;
        --focus: #81a1c1;
        --page-glow-1: rgba(94, 129, 172, .2);
        --page-glow-2: rgba(136, 192, 208, .1);
        --hero-gradient-start: rgba(94, 129, 172, .24);
        --hero-gradient-end: rgba(13, 20, 33, .24);
        --hero-orb: rgba(163, 190, 140, .16);
        --toolbar-gradient-start: rgba(94, 129, 172, .18);
        --toolbar-gradient-mid: rgba(136, 192, 208, .07);
        --toolbar-glow: rgba(136, 192, 208, .12);
        --toolbar-glow-secondary: rgba(163, 190, 140, .08);
        --badge-folder-fg: #9ad7e4;
        --badge-folder-bg: rgba(136, 192, 208, .13);
        --badge-folder-border: rgba(154, 215, 228, .36);
        --badge-file-fg: #b8c7e8;
        --badge-file-bg: rgba(129, 161, 193, .13);
        --badge-file-border: rgba(184, 199, 232, .34);
        --badge-line-fg: #b7d99b;
        --badge-line-bg: rgba(163, 190, 140, .13);
        --badge-line-border: rgba(183, 217, 155, .36);
        --badge-pin-fg: #f2cf8f;
        --badge-pin-bg: rgba(235, 203, 139, .14);
        --badge-pin-border: rgba(242, 207, 143, .36);
        --badge-missing-fg: #e2838c;
        --badge-missing-bg: rgba(191, 97, 106, .14);
        --badge-missing-border: rgba(226, 131, 140, .36);
        --shadow-lg: 0 18px 40px rgba(4, 9, 17, .38);
        --shadow-md: 0 10px 24px rgba(4, 9, 17, .26);
      }

      body.theme-coffee {
        color-scheme: dark;
        --bg: #181825;
        --panel: #242438;
        --panel-2: #1e1e2e;
        --panel-3: #11111b;
        --border: rgba(205, 214, 244, .17);
        --fg: #cdd6f4;
        --muted: #a6adc8;
        --accent: #cba6f7;
        --accent-soft: rgba(203, 166, 247, .18);
        --accent-fg: #1e1e2e;
        --success: #a6e3a1;
        --warning: #f9e2af;
        --danger: #f38ba8;
        --focus: #b4befe;
        --page-glow-1: rgba(203, 166, 247, .18);
        --page-glow-2: rgba(137, 220, 235, .08);
        --hero-gradient-start: rgba(203, 166, 247, .2);
        --hero-gradient-end: rgba(17, 17, 27, .24);
        --hero-orb: rgba(166, 227, 161, .14);
        --toolbar-gradient-start: rgba(203, 166, 247, .14);
        --toolbar-gradient-mid: rgba(137, 180, 250, .06);
        --toolbar-glow: rgba(203, 166, 247, .12);
        --toolbar-glow-secondary: rgba(166, 227, 161, .06);
        --badge-folder-fg: #89dceb;
        --badge-folder-bg: rgba(137, 220, 235, .13);
        --badge-folder-border: rgba(137, 220, 235, .36);
        --badge-file-fg: #b4befe;
        --badge-file-bg: rgba(180, 190, 254, .13);
        --badge-file-border: rgba(180, 190, 254, .36);
        --badge-line-fg: #a6e3a1;
        --badge-line-bg: rgba(166, 227, 161, .13);
        --badge-line-border: rgba(166, 227, 161, .36);
        --badge-pin-fg: #f9e2af;
        --badge-pin-bg: rgba(249, 226, 175, .14);
        --badge-pin-border: rgba(249, 226, 175, .38);
        --badge-missing-fg: #f38ba8;
        --badge-missing-bg: rgba(243, 139, 168, .13);
        --badge-missing-border: rgba(243, 139, 168, .36);
        --shadow-lg: 0 18px 40px rgba(8, 8, 14, .42);
        --shadow-md: 0 10px 24px rgba(8, 8, 14, .28);
      }

      body.theme-sunlit {
        color-scheme: light;
        --bg: #fdf6e3;
        --panel: #fffaf0;
        --panel-2: #eee8d5;
        --panel-3: #e6dfc8;
        --border: rgba(101, 123, 131, .26);
        --fg: #073642;
        --muted: #657b83;
        --accent: #268bd2;
        --accent-soft: rgba(38, 139, 210, .14);
        --accent-fg: #ffffff;
        --success: #859900;
        --warning: #b58900;
        --danger: #dc322f;
        --focus: #268bd2;
        --page-glow-1: rgba(38, 139, 210, .12);
        --page-glow-2: rgba(133, 153, 0, .08);
        --hero-gradient-start: rgba(38, 139, 210, .13);
        --hero-gradient-end: rgba(253, 246, 227, .72);
        --hero-sheen-start: rgba(255, 250, 240, .88);
        --hero-sheen-end: rgba(255, 250, 240, .58);
        --hero-orb: rgba(133, 153, 0, .12);
        --toolbar-gradient-start: rgba(38, 139, 210, .11);
        --toolbar-gradient-mid: rgba(253, 246, 227, .78);
        --toolbar-gradient-end: rgba(253, 246, 227, .52);
        --toolbar-glow: rgba(38, 139, 210, .11);
        --toolbar-glow-secondary: rgba(133, 153, 0, .06);
        --badge-folder-fg: #1f6f9f;
        --badge-folder-bg: rgba(38, 139, 210, .1);
        --badge-folder-border: rgba(38, 139, 210, .3);
        --badge-file-fg: #4f63b5;
        --badge-file-bg: rgba(79, 99, 181, .1);
        --badge-file-border: rgba(79, 99, 181, .28);
        --badge-line-fg: #5f7300;
        --badge-line-bg: rgba(133, 153, 0, .13);
        --badge-line-border: rgba(133, 153, 0, .32);
        --badge-pin-fg: #8a5a00;
        --badge-pin-bg: rgba(181, 137, 0, .14);
        --badge-pin-border: rgba(181, 137, 0, .34);
        --badge-missing-fg: #b8322f;
        --badge-missing-bg: rgba(220, 50, 47, .1);
        --badge-missing-border: rgba(220, 50, 47, .3);
        --shadow-lg: 0 18px 40px rgba(101, 83, 22, .14);
        --shadow-md: 0 10px 24px rgba(101, 83, 22, .1);
      }

      body.theme-clean {
        color-scheme: light;
        --bg: #ffffff;
        --panel: #ffffff;
        --panel-2: #f6f8fa;
        --panel-3: #eaeef2;
        --border: rgba(31, 35, 40, .15);
        --fg: #24292f;
        --muted: #57606a;
        --accent: #0969da;
        --accent-soft: rgba(9, 105, 218, .12);
        --accent-fg: #ffffff;
        --success: #1a7f37;
        --warning: #9a6700;
        --danger: #cf222e;
        --focus: #0969da;
        --page-glow-1: rgba(9, 105, 218, .1);
        --page-glow-2: rgba(26, 127, 55, .05);
        --hero-gradient-start: rgba(9, 105, 218, .11);
        --hero-gradient-end: rgba(255, 255, 255, .78);
        --hero-sheen-start: rgba(255,255,255,.94);
        --hero-sheen-end: rgba(246,248,250,.72);
        --hero-orb: rgba(26, 127, 55, .1);
        --toolbar-gradient-start: rgba(9, 105, 218, .08);
        --toolbar-gradient-mid: rgba(246,248,250,.84);
        --toolbar-gradient-end: rgba(246,248,250,.62);
        --toolbar-glow: rgba(9, 105, 218, .08);
        --toolbar-glow-secondary: rgba(26, 127, 55, .04);
        --badge-folder-fg: #0969da;
        --badge-folder-bg: rgba(9, 105, 218, .09);
        --badge-folder-border: rgba(9, 105, 218, .28);
        --badge-file-fg: #4d5bd1;
        --badge-file-bg: rgba(77, 91, 209, .09);
        --badge-file-border: rgba(77, 91, 209, .28);
        --badge-line-fg: #1a7f37;
        --badge-line-bg: rgba(26, 127, 55, .1);
        --badge-line-border: rgba(26, 127, 55, .3);
        --badge-pin-fg: #9a6700;
        --badge-pin-bg: rgba(154, 103, 0, .12);
        --badge-pin-border: rgba(154, 103, 0, .3);
        --badge-missing-fg: #cf222e;
        --badge-missing-bg: rgba(207, 34, 46, .09);
        --badge-missing-border: rgba(207, 34, 46, .3);
        --shadow-lg: 0 18px 40px rgba(31, 35, 40, .12);
        --shadow-md: 0 10px 24px rgba(31, 35, 40, .08);
      }

      body.theme-purple {
        color-scheme: dark;
        --bg: #120f1f;
        --panel: #211a35;
        --panel-2: #191328;
        --panel-3: #0e0a19;
        --border: rgba(232, 213, 255, .18);
        --fg: #f4edff;
        --muted: #b9a7d8;
        --accent: #bd7cff;
        --accent-soft: rgba(189, 124, 255, .2);
        --accent-fg: #140d22;
        --success: #75f0c0;
        --warning: #ffd166;
        --danger: #ff76a8;
        --focus: #d6a7ff;
        --page-glow-1: rgba(189, 124, 255, .22);
        --page-glow-2: rgba(117, 240, 192, .08);
        --hero-gradient-start: rgba(189, 124, 255, .24);
        --hero-gradient-end: rgba(20, 13, 34, .28);
        --hero-orb: rgba(117, 240, 192, .14);
        --toolbar-gradient-start: rgba(189, 124, 255, .18);
        --toolbar-gradient-mid: rgba(255, 118, 168, .06);
        --toolbar-glow: rgba(189, 124, 255, .14);
        --toolbar-glow-secondary: rgba(117, 240, 192, .06);
        --badge-folder-fg: #8bd9ff;
        --badge-folder-bg: rgba(139, 217, 255, .13);
        --badge-folder-border: rgba(139, 217, 255, .36);
        --badge-file-fg: #d2b3ff;
        --badge-file-bg: rgba(189, 124, 255, .14);
        --badge-file-border: rgba(210, 179, 255, .36);
        --badge-line-fg: #75f0c0;
        --badge-line-bg: rgba(117, 240, 192, .13);
        --badge-line-border: rgba(117, 240, 192, .36);
        --badge-pin-fg: #ffd166;
        --badge-pin-bg: rgba(255, 209, 102, .14);
        --badge-pin-border: rgba(255, 209, 102, .38);
        --badge-missing-fg: #ff8eb8;
        --badge-missing-bg: rgba(255, 118, 168, .13);
        --badge-missing-border: rgba(255, 142, 184, .36);
        --shadow-lg: 0 18px 40px rgba(6, 3, 14, .46);
        --shadow-md: 0 10px 24px rgba(6, 3, 14, .3);
      }

      body.theme-contrast {
        color-scheme: dark;
        --bg: #000000;
        --panel: #101010;
        --panel-2: #080808;
        --panel-3: #000000;
        --border: rgba(255, 255, 255, .5);
        --fg: #ffffff;
        --muted: #d7d7d7;
        --accent: #ffff00;
        --accent-soft: rgba(255, 255, 0, .2);
        --accent-fg: #000000;
        --success: #00ff87;
        --warning: #ffff00;
        --danger: #ff5c8a;
        --focus: #ffff00;
        --page-glow-1: rgba(255, 255, 0, .12);
        --page-glow-2: rgba(0, 255, 135, .08);
        --hero-gradient-start: rgba(255, 255, 0, .12);
        --hero-gradient-end: rgba(0, 0, 0, .4);
        --hero-sheen-start: rgba(255,255,255,.08);
        --hero-sheen-end: rgba(255,255,255,.02);
        --hero-orb: rgba(255, 255, 0, .14);
        --toolbar-gradient-start: rgba(255, 255, 0, .1);
        --toolbar-gradient-mid: rgba(255,255,255,.04);
        --toolbar-gradient-end: rgba(0,0,0,.02);
        --toolbar-glow: rgba(255, 255, 0, .1);
        --toolbar-glow-secondary: rgba(0, 255, 135, .06);
        --badge-folder-fg: #00d7ff;
        --badge-folder-bg: #001f29;
        --badge-folder-border: #00d7ff;
        --badge-file-fg: #a8b6ff;
        --badge-file-bg: #111538;
        --badge-file-border: #a8b6ff;
        --badge-line-fg: #00ff87;
        --badge-line-bg: #002918;
        --badge-line-border: #00ff87;
        --badge-pin-fg: #ffff00;
        --badge-pin-bg: #2b2b00;
        --badge-pin-border: #ffff00;
        --badge-missing-fg: #ff7aa7;
        --badge-missing-bg: #2b0011;
        --badge-missing-border: #ff7aa7;
        --shadow-lg: 0 18px 40px rgba(0, 0, 0, .72);
        --shadow-md: 0 10px 24px rgba(0, 0, 0, .56);
      }

      body.theme-light .hero {
        background:
          linear-gradient(165deg, rgba(82, 105, 216, .14), rgba(255,255,255,.72)),
          linear-gradient(180deg, rgba(255,255,255,.86), rgba(255,255,255,.58));
      }

      body.theme-light .toolbar-card {
        background:
          linear-gradient(180deg, rgba(82,105,216,.12), rgba(255,255,255,.72) 42%, rgba(255,255,255,.52)),
          linear-gradient(180deg, rgba(255,255,255,.88), rgba(255,255,255,.7));
      }

      body.theme-light .toolbar-card,
      body.theme-light .empty,
      body.theme-light .section {
        box-shadow: var(--shadow-md);
      }

      body.theme-light .stat {
        border-color: rgba(53,65,101,.12);
        background: rgba(255,255,255,.56);
      }

      body.theme-light .hero-toggle,
      body.theme-light .action,
      body.theme-light .chip,
      body.theme-light .pill,
      body.theme-light .section-sort,
      body.theme-light .section-menu,
      body.theme-light .bookmark-menu,
      body.theme-light .bookmark-shift {
        border-color: rgba(53,65,101,.18);
        background: rgba(255,255,255,.62);
      }

      body.theme-light .context-menu button:hover,
      body.theme-light .inline-menu button:hover,
      body.theme-light .overlay-menu button:hover,
      body.theme-sunlit .context-menu button:hover,
      body.theme-sunlit .inline-menu button:hover,
      body.theme-sunlit .overlay-menu button:hover,
      body.theme-clean .context-menu button:hover,
      body.theme-clean .inline-menu button:hover,
      body.theme-clean .overlay-menu button:hover {
        background: rgba(53,65,101,.07);
      }

      button, input {
        font: inherit;
      }

      .app {
        padding: 14px;
        width: 100%;
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
          linear-gradient(165deg, var(--hero-gradient-start), var(--hero-gradient-end)),
          linear-gradient(180deg, var(--hero-sheen-start), var(--hero-sheen-end));
        box-shadow: var(--shadow-lg);
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -20% -40% auto;
        width: 180px;
        height: 180px;
        border-radius: 999px;
        background: radial-gradient(circle, var(--hero-orb), transparent 68%);
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
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .hero-copy {
        min-width: 0;
      }

      .title-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-start;
        min-width: 0;
      }

      h1 {
        margin: 6px 0 0;
        font-size: 17px;
        letter-spacing: -0.02em;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .hero-toggle {
        min-height: 24px;
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

      .theme-control {
        position: relative;
        flex: 0 0 auto;
      }

      .hero-icon-toggle {
        width: 26px;
        min-width: 26px;
        padding: 0;
        font-size: 14px;
      }

      .feedback-toggle {
        font-size: 12px;
        font-weight: 700;
      }

      .quick-tooltip {
        position: fixed;
        z-index: 240;
        max-width: 220px;
        padding: 5px 8px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 88%, black 12%);
        color: var(--fg);
        box-shadow: var(--shadow-md);
        font-size: 11px;
        line-height: 1.3;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transform: translateY(2px);
        transition: opacity .08s ease, transform .08s ease;
      }

      .quick-tooltip.visible {
        opacity: 1;
        transform: translateY(0);
      }

      .hero-toggle:hover {
        transform: translateY(-1px);
        filter: brightness(1.05);
      }

      .theme-menu {
        position: fixed;
        top: auto;
        right: auto;
        left: auto;
        z-index: 120;
        min-width: 174px;
      }

      .theme-menu button {
        display: flex;
        align-items: center;
        gap: 9px;
      }

      .theme-menu button.is-active {
        background: rgba(109,141,255,.14);
        color: var(--fg);
      }

      .theme-swatch {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.24);
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.1);
        flex: 0 0 auto;
      }

      .theme-swatch.system { background: conic-gradient(#7d92ff 0 25%, #f5f7fb 0 50%, #141520 0 75%, #88c0d0 0); }
      .theme-swatch.dark { background: linear-gradient(135deg, #141520 0 48%, #7d92ff 48%); }
      .theme-swatch.light { background: linear-gradient(135deg, #f5f7fb 0 48%, #5269d8 48%); }
      .theme-swatch.aurora { background: linear-gradient(135deg, #101827 0 48%, #88c0d0 48%); }
      .theme-swatch.coffee { background: linear-gradient(135deg, #181825 0 48%, #cba6f7 48%); }
      .theme-swatch.sunlit { background: linear-gradient(135deg, #fdf6e3 0 48%, #268bd2 48%); }
      .theme-swatch.clean { background: linear-gradient(135deg, #ffffff 0 48%, #0969da 48%); }
      .theme-swatch.purple { background: linear-gradient(135deg, #120f1f 0 48%, #bd7cff 48%); }
      .theme-swatch.contrast { background: linear-gradient(135deg, #000000 0 48%, #ffff00 48%); }

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
          linear-gradient(180deg, var(--toolbar-gradient-start), var(--toolbar-gradient-mid) 38%, var(--toolbar-gradient-end)),
          linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.05), var(--shadow-md);
      }

      .toolbar-card::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
          radial-gradient(circle at top right, var(--toolbar-glow), transparent 36%),
          radial-gradient(circle at bottom left, var(--toolbar-glow-secondary), transparent 28%);
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
        grid-template-columns: 1fr;
        gap: 8px;
        align-items: center;
      }

      .action-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .toolbar-primary {
        display: none;
        position: relative;
      }

      #btn-clean-missing {
        width: 100%;
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
      .hero-toggle:focus-visible,
      .section-chevron:focus-visible,
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
        gap: 2px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
      }

      .section-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .section-chevron {
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex: 0 0 auto;
        line-height: 1;
        font-size: 0;
        opacity: .92;
      }

      .section-chevron::before {
        content: "";
        width: 0;
        height: 0;
        border-style: solid;
        border-width: 4px 0 4px 5px;
        border-color: transparent transparent transparent currentColor;
        transform: rotate(90deg);
        transition: transform .12s ease;
      }

      .section-chevron[data-collapsed="true"]::before {
        transform: rotate(0deg);
      }

      .section-header[data-group-header-toggle]:hover .section-chevron {
        color: var(--fg);
      }

      .section-header[data-group-header-toggle] .section-title-wrap {
        cursor: pointer;
      }

      .section-subtitle {
        margin-top: 4px;
        font-size: 12px;
        color: var(--muted);
      }

      .section-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        justify-content: end;
      }

      .pill {
        box-sizing: border-box;
        min-height: 28px;
        min-width: 52px;
        padding: 0 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.03);
        color: var(--muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }

      .section-sort,
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

      .section-control {
        box-sizing: border-box;
        height: 28px;
        min-height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }

      .section-sort,
      .section-menu,
      .bookmark-menu,
      .bookmark-shift {
        min-height: 28px;
        min-width: 28px;
        padding: 0 10px;
      }

      .section-sort {
        color: var(--muted);
        min-width: 52px;
        padding: 0 8px;
        text-align: center;
        flex-shrink: 0;
      }

      .section-menu {
        width: 30px;
        min-width: 30px;
        padding: 0;
        color: var(--muted);
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

      .section-bookmark-drop-target {
        box-shadow: inset 0 0 0 1px rgba(109,141,255,.52);
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
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        padding: 12px;
        padding-right: 54px;
        border-radius: var(--radius-lg);
        border: 1px solid rgba(255,255,255,.05);
        background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.015));
        position: relative;
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

      .bookmark.is-draggable {
        cursor: grab;
      }

      .bookmark.is-dragging {
        opacity: .56;
        cursor: grabbing;
      }

      .bookmark.is-drop-before {
        box-shadow: inset 0 2px 0 rgba(109,141,255,.82);
      }

      .bookmark.is-drop-after {
        box-shadow: inset 0 -2px 0 rgba(109,141,255,.82);
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
      .pin-badge,
      .line-badge {
        min-height: 20px;
        padding: 0 8px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        border: 1px solid var(--border);
      }

      .type-badge.folder {
        color: var(--badge-folder-fg);
        border-color: var(--badge-folder-border);
        background: var(--badge-folder-bg);
      }

      .type-badge.file {
        color: var(--badge-file-fg);
        border-color: var(--badge-file-border);
        background: var(--badge-file-bg);
      }

      .type-badge.line {
        color: var(--badge-line-fg);
        border-color: var(--badge-line-border);
        background: var(--badge-line-bg);
      }

      .status-badge.missing {
        color: var(--badge-missing-fg);
        border-color: var(--badge-missing-border);
        background: var(--badge-missing-bg);
      }

      .pin-badge {
        color: var(--badge-pin-fg);
        border-color: var(--badge-pin-border);
        background: var(--badge-pin-bg);
      }

      .line-badge {
        color: var(--muted);
        background: rgba(255,255,255,.025);
      }

      .bookmark-path {
        margin-top: 6px;
        color: var(--muted);
        word-break: break-word;
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
        position: absolute;
        top: 12px;
        right: 12px;
        gap: 6px;
      }

      .bookmark-menu,
      .bookmark-shift {
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

      .context-menu button:disabled {
        color: var(--muted);
        cursor: not-allowed;
        opacity: .55;
      }

      .context-menu button:disabled:hover {
        background: transparent;
      }

      .context-menu button.danger {
        color: var(--danger);
      }

      .context-submenu {
        display: none;
        margin: 2px 0 2px 10px;
        padding: 4px 0 4px 8px;
        border-left: 1px solid var(--border);
      }

      .context-submenu.visible {
        display: grid;
        gap: 2px;
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
        display: none;
        text-align: center;
        font-size: 12px;
        padding-bottom: 8px;
      }

      body.is-compact {
        --sidebar-min-width: 304px;
      }

      body.is-compact .app {
        padding: 8px;
        gap: 8px;
      }

      body.is-compact .hero,
      body.is-compact .toolbar-card,
      body.is-compact .section,
      body.is-compact .empty {
        border-radius: var(--radius-sm);
        box-shadow: none;
      }

      body.is-compact .hero {
        padding: 10px 12px;
      }

      body.is-compact .hero::after,
      body.is-compact .stats,
      body.is-compact .footer-tip {
        display: none;
      }

      body.is-compact .eyebrow {
        display: none;
      }

      body.is-compact h1 {
        margin: 1px 0 0;
        font-size: 13px;
        line-height: 1.2;
      }

      body.is-compact .hero-top {
        gap: 7px;
      }

      body.is-compact .title-actions {
        gap: 5px;
      }

      body.is-compact .hero-toggle {
        min-height: 22px;
        padding: 0 7px;
        font-size: 11px;
      }

      body.is-compact .toolbar-card {
        padding: 8px;
        gap: 8px;
      }

      body.is-compact .toolbar-card::before {
        opacity: .45;
      }

      body.is-compact .action {
        min-height: 30px;
        padding: 0 10px;
        gap: 6px;
      }

      body.is-compact .search-row {
        gap: 6px;
      }

      body.is-compact .search-input {
        min-height: 30px;
        padding: 0 10px;
      }

      body.is-compact .chips {
        gap: 4px;
      }

      body.is-compact .chip {
        min-height: 24px;
        padding: 0 8px;
        font-size: 11px;
      }

      body.is-compact .sections {
        gap: 6px;
      }

      body.is-compact .section-header {
        padding: 6px 10px 6px 6px;
        gap: 6px;
      }

      body.is-compact .section-title {
        gap: 2px;
        font-size: 11px;
      }

      body.is-compact .section-meta {
        gap: 4px;
      }

      body.is-compact .pill {
        min-height: 24px;
        min-width: 44px;
        padding: 0 6px;
        font-size: 10px;
      }

      body.is-compact .section-control {
        height: 24px;
        min-height: 24px;
        font-size: 10px;
      }

      body.is-compact .section-sort,
      body.is-compact .section-menu,
      body.is-compact .bookmark-menu,
      body.is-compact .bookmark-shift {
        min-height: 24px;
        min-width: 24px;
        padding: 0 6px;
        font-size: 11px;
      }

      body.is-compact .section-sort {
        min-width: 44px;
      }

      body.is-compact .section-menu {
        width: 24px;
        padding: 0;
      }

      body.is-compact .section-meta .section-control {
        font-size: 10px;
      }

      body.is-compact .section-list {
        gap: 4px;
        padding: 0 6px 6px;
      }

      body.is-compact .bookmark {
        gap: 6px;
        padding: 7px 8px;
        padding-right: 38px;
        border-radius: 8px;
      }

      body.is-compact .bookmark-label {
        font-size: 12px;
        line-height: 1.25;
      }

      body.is-compact .bookmark-tags {
        gap: 4px;
        margin-top: 4px;
        min-height: 16px;
      }

      body.is-compact .type-badge,
      body.is-compact .status-badge,
      body.is-compact .pin-badge,
      body.is-compact .line-badge {
        min-height: 16px;
        padding: 0 5px;
        font-size: 10px;
      }

      body.is-compact .bookmark-path {
        margin-top: 3px;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      body.is-compact .bookmark-actions {
        position: absolute;
        top: 7px;
        right: 7px;
        gap: 0;
      }

      body.is-compact .bookmark-menu {
        width: 24px;
        min-width: 24px;
        min-height: 24px;
        padding: 0;
        font-size: 11px;
      }

      body.is-compact .bookmark-shift {
        display: none;
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
          padding-top: 0;
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
            <h1 id="hero-title">导航</h1>
          </div>
          <div class="title-actions">
            <button id="compact-toggle" class="hero-toggle" aria-pressed="false">紧凑</button>
            <button id="locale-toggle" class="hero-toggle">English</button>
            <div class="theme-control">
              <button id="theme-toggle" class="hero-toggle hero-icon-toggle" type="button" aria-haspopup="menu" aria-expanded="false">◐</button>
            </div>
            <button id="feedback-toggle" class="hero-toggle hero-icon-toggle feedback-toggle" type="button">?</button>
          </div>
        </div>
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
        <button data-menu-action="move-up">上移</button>
        <button data-menu-action="move-down">下移</button>
        <button data-menu-action="move-group">移动到分组</button>
        <div id="move-group-submenu" class="context-submenu"></div>
        <button data-menu-action="rename">改名</button>
        <button class="danger" data-menu-action="delete">删掉</button>
      </div>

      <div id="group-menu" class="context-menu">
        <button data-group-menu-action="create">新建分组</button>
        <button data-group-menu-action="rename">重命名分组</button>
        <button class="danger" data-group-menu-action="delete">删除分组</button>
      </div>

      <div id="picker-menu" class="overlay-menu"></div>
      <div id="theme-menu" class="inline-menu theme-menu" role="menu">
      </div>
      <div id="quick-tooltip" class="quick-tooltip" role="tooltip"></div>

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
        contextMoveGroupExpanded: false,
        groupMenu: { visible: false, groupId: null, x: 0, y: 0 },
        pickerMenu: { visible: false, mode: null, x: 0, y: 0, bookmarkId: null, groupId: null },
        editingBookmarkId: null,
        editingValue: "",
        draggingGroupId: null,
        draggingBookmarkId: null,
        draggingBookmarkGroupId: null,
        bookmarkDropGroupId: null,
        suppressNextOpen: false,
        suppressNextGroupToggle: false,
        groupFormVisible: false,
        groupFormMode: "create",
        editingGroupId: null
      };

      const sectionsEl = document.getElementById("sections");
      const emptyEl = document.getElementById("empty-state");
      const searchInput = document.getElementById("search-input");
      const chips = Array.from(document.querySelectorAll(".chip"));
      const contextMenuEl = document.getElementById("context-menu");
      const moveGroupSubmenuEl = document.getElementById("move-group-submenu");
      const groupMenuEl = document.getElementById("group-menu");
      const pickerMenuEl = document.getElementById("picker-menu");
      const addMenuEl = document.getElementById("add-menu");
      const createGroupFormEl = document.getElementById("create-group-form");
      const createGroupInputEl = document.getElementById("create-group-input");
      const createGroupSaveEl = document.getElementById("create-group-save");
      const createGroupCancelEl = document.getElementById("create-group-cancel");
      const localeToggleEl = document.getElementById("locale-toggle");
      const compactToggleEl = document.getElementById("compact-toggle");
      const themeToggleEl = document.getElementById("theme-toggle");
      const themeMenuEl = document.getElementById("theme-menu");
      const feedbackToggleEl = document.getElementById("feedback-toggle");
      const quickTooltipEl = document.getElementById("quick-tooltip");
      let quickTooltipTimer = 0;
      searchInput.value = state.query;

      const i18n = {
        zh: {
          languageCurrent: "语言：中文",
          compactStandard: "模式：标准",
          compactCompact: "模式：紧凑",
          heroTitle: "导航",
          themeLabel: "切换主题",
          themeSystem: "跟随编辑器",
          themeDark: "深色",
          themeLight: "浅色",
          themeAurora: "极光",
          themeCoffee: "咖啡",
          themeSunlit: "日光",
          themeClean: "清爽浅色",
          themePurple: "紫夜",
          themeContrast: "高对比度",
          feedbackLabel: "反馈问题",
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
          sortCreatedAt: "最近添加",
          sortUpdatedAt: "最近修改",
          sortType: "类型",
          moveUp: "上移",
          moveDown: "下移",
          emptyGroup: "这个分组还没有书签。"
        },
        en: {
          languageCurrent: "English",
          compactStandard: "Standard",
          compactCompact: "Compact",
          heroTitle: "Navigator",
          themeLabel: "Switch Theme",
          themeSystem: "Follow Editor",
          themeDark: "Dark",
          themeLight: "Light",
          themeAurora: "Aurora",
          themeCoffee: "Coffee",
          themeSunlit: "Sunlit",
          themeClean: "Clean Light",
          themePurple: "Purple Night",
          themeContrast: "High Contrast",
          feedbackLabel: "Send Feedback",
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
          sortCreatedAt: "Recently Added",
          sortUpdatedAt: "Recently Updated",
          sortType: "Type",
          moveUp: "Up",
          moveDown: "Down",
          emptyGroup: "This group does not have any bookmarks yet."
        }
      };

      const themeOptions = [
        { id: "system", labelKey: "themeSystem" },
        { id: "dark", labelKey: "themeDark" },
        { id: "light", labelKey: "themeLight" },
        { id: "aurora", labelKey: "themeAurora" },
        { id: "coffee", labelKey: "themeCoffee" },
        { id: "purple", labelKey: "themePurple" },
        { id: "contrast", labelKey: "themeContrast" },
        { id: "sunlit", labelKey: "themeSunlit" },
        { id: "clean", labelKey: "themeClean" }
      ];

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

      function themeText(dict, themeMode) {
        if (themeMode === "dark") return dict.themeDark;
        if (themeMode === "light") return dict.themeLight;
        if (themeMode === "aurora") return dict.themeAurora;
        if (themeMode === "coffee") return dict.themeCoffee;
        if (themeMode === "purple") return dict.themePurple;
        if (themeMode === "contrast") return dict.themeContrast;
        if (themeMode === "sunlit") return dict.themeSunlit;
        if (themeMode === "clean") return dict.themeClean;
        return dict.themeSystem;
      }

      function applyThemeMode(themeMode) {
        themeOptions.forEach((option) => {
          if (option.id !== "system") {
            document.body.classList.toggle("theme-" + option.id, themeMode === option.id);
          }
        });
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
	        if (section.system && section.items.length === 0 && !state.query && state.filter === "all") return "";
	        if (items.length === 0 && (state.query || state.filter !== "all")) return "";
        const compact = state.data?.compactMode === true || section.density === "compact";
        const manualSort = section.sortBy === "manual";
        const dragSortEnabled = !state.query.trim() && state.filter === "all";

        const toneClass = section.tone === "accent" ? "accent" : section.tone === "warning" ? "warning" : "";
        const rows = items.map((item) => {
          const pathText = item.path;
          const lineBadgeText = item.type === "line" && item.line ? "L" + item.line : "";
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
          const dragAttributes = dragSortEnabled
            ? ' draggable="true" data-draggable-bookmark="' + item.id + '" data-bookmark-group="' + section.groupId + '"'
            : "";
          return \`
            <article class="bookmark \${compact ? "compact" : ""} \${dragSortEnabled ? "is-draggable" : ""} \${state.draggingBookmarkId === item.id ? "is-dragging" : ""} \${item.missing ? "is-missing" : ""} \${item.pinned ? "is-pinned" : ""} \${state.data.highlightedBookmarkId === item.id ? "is-highlighted" : ""}" data-open="\${item.id}" data-bookmark-id="\${item.id}" data-bookmark-group="\${section.groupId}"\${dragAttributes}>
              <div class="bookmark-main">
                <div class="bookmark-head">
                  <div class="bookmark-label-row">\${labelArea}</div>
                </div>
                <div class="bookmark-tags">
                  <span class="type-badge \${item.type}">\${typeLabel(item.type)}</span>
                  \${lineBadgeText ? '<span class="line-badge">' + escapeHtml(lineBadgeText) + '</span>' : ""}
                  \${item.pinned ? '<span class="pin-badge">' + dict.pinnedBadge + '</span>' : ""}
                  \${item.missing ? '<span class="status-badge missing">' + dict.missingBadge + '</span>' : ""}
                </div>
                <div class="bookmark-path">\${escapeHtml(pathText)}</div>
              </div>
              <div class="bookmark-actions">
                \${manualSort && compact ? '<button class="bookmark-shift" title="' + dict.moveUp + '" data-move-bookmark="up" data-bookmark-id="' + item.id + '">↑</button>' : ""}
                \${manualSort && compact ? '<button class="bookmark-shift" title="' + dict.moveDown + '" data-move-bookmark="down" data-bookmark-id="' + item.id + '">↓</button>' : ""}
                <button class="bookmark-menu" title="More" data-menu="\${item.id}">···</button>
              </div>
            </article>
          \`;
        }).join("");

	        return \`
	          <section class="section \${state.draggingGroupId === section.groupId ? "section-drop-target" : ""} \${state.bookmarkDropGroupId === section.groupId ? "section-bookmark-drop-target" : ""}" data-section-group="\${section.groupId}">
	            <div class="section-header \${toneClass} \${section.draggable ? "is-draggable" : ""}" data-group-header-toggle="\${section.groupId}" data-next-collapsed="\${String(!collapsed)}" \${section.draggable ? 'draggable="true" data-draggable-group="' + section.groupId + '"' : ""}>
	              <div class="section-title-wrap">
	                <div class="section-title">
	                  <button class="section-chevron" data-group-toggle="\${section.groupId}" data-next-collapsed="\${String(!collapsed)}" data-collapsed="\${String(collapsed)}" aria-label="\${collapsed ? dict.expand : dict.collapse}" aria-expanded="\${String(!collapsed)}">\${collapsed ? "▸" : "▾"}</button>
	                  <span class="section-name">\${escapeHtml(section.title)}</span>
	                </div>
	                \${section.subtitle ? '<div class="section-subtitle">' + escapeHtml(section.subtitle) + '</div>' : ""}
	              </div>
	              <div class="section-meta">
		                <span class="pill section-control section-count">\${items.length} \${dict.itemSuffix}</span>
		                <button class="section-control section-sort" data-section-sort="\${section.groupId}">\${dict.sortSection}</button>
		                <button class="section-control section-menu" data-group-menu="\${section.groupId}">···</button>
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
        document.body.classList.toggle("is-compact", data.compactMode === true);
        applyThemeMode(data.themeMode || "system");
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
        document.getElementById("locale-toggle").textContent = dict.languageCurrent;
        compactToggleEl.textContent = state.data?.compactMode ? dict.compactCompact : dict.compactStandard;
        compactToggleEl.setAttribute("aria-pressed", state.data?.compactMode ? "true" : "false");
        themeToggleEl.setAttribute("aria-label", dict.themeLabel + ": " + themeText(dict, state.data?.themeMode || "system"));
        themeToggleEl.setAttribute("data-quick-tooltip", dict.themeLabel + ": " + themeText(dict, state.data?.themeMode || "system"));
        themeToggleEl.removeAttribute("title");
        feedbackToggleEl.setAttribute("aria-label", dict.feedbackLabel);
        feedbackToggleEl.setAttribute("data-quick-tooltip", dict.feedbackLabel);
        feedbackToggleEl.removeAttribute("title");
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
        const currentThemeMode = state.data?.themeMode || "system";
        themeMenuEl.innerHTML = themeOptions.map((option) => {
          const isActive = option.id === currentThemeMode;
          return (
            '<button class="' +
            (isActive ? "is-active" : "") +
            '" data-theme-option="' +
            option.id +
            '" role="menuitemradio" aria-checked="' +
            (isActive ? "true" : "false") +
            '">' +
            '<span class="theme-swatch ' +
            option.id +
            '"></span><span>' +
            escapeHtml(dict[option.labelKey]) +
            "</span></button>"
          );
        }).join("");

        contextMenuEl.querySelector('[data-menu-action="open"]').textContent = dict.open;
        contextMenuEl.querySelector('[data-menu-action="move-up"]').textContent = dict.moveUp;
        contextMenuEl.querySelector('[data-menu-action="move-down"]').textContent = dict.moveDown;
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
        const currentSection = findSectionForBookmark(bookmark.id);
        const bookmarkIndex = currentSection ? currentSection.items.findIndex((item) => item.id === bookmark.id) : -1;
        const previousBookmark = currentSection && bookmarkIndex > 0 ? currentSection.items[bookmarkIndex - 1] : null;
        const nextBookmark = currentSection && bookmarkIndex >= 0 ? currentSection.items[bookmarkIndex + 1] : null;
        const moveUpButton = contextMenuEl.querySelector('[data-menu-action="move-up"]');
        const moveDownButton = contextMenuEl.querySelector('[data-menu-action="move-down"]');
        if (moveUpButton) {
          moveUpButton.style.display = "block";
          moveUpButton.disabled = !currentSection || bookmarkIndex <= 0 || previousBookmark?.pinned !== bookmark.pinned;
        }
        if (moveDownButton) {
          moveDownButton.style.display = "block";
          moveDownButton.disabled = !currentSection || bookmarkIndex < 0 || !nextBookmark || nextBookmark.pinned !== bookmark.pinned;
        }
        const moveGroupButton = contextMenuEl.querySelector('[data-menu-action="move-group"]');
        if (moveGroupButton) {
          const currentGroupId = findSectionIdForBookmark(bookmark.id);
          moveGroupButton.disabled = listMoveGroupTargets(state.data.sections, currentGroupId).length === 0;
        }
        renderMoveGroupSubmenu(bookmark.id);
      }

      function renderMoveGroupSubmenu(bookmarkId) {
        if (!state.data || !state.contextMoveGroupExpanded) {
          moveGroupSubmenuEl.innerHTML = "";
          moveGroupSubmenuEl.classList.remove("visible");
          return;
        }
        const currentGroupId = findSectionIdForBookmark(bookmarkId);
        const options = listMoveGroupTargets(state.data.sections, currentGroupId);
        if (options.length === 0) {
          moveGroupSubmenuEl.innerHTML = "";
          moveGroupSubmenuEl.classList.remove("visible");
          return;
        }
        moveGroupSubmenuEl.innerHTML = options
          .map((section) =>
            '<button data-context-move-group="' +
            section.groupId +
            '" data-bookmark-id="' +
            bookmarkId +
            '">' +
            escapeHtml(section.title) +
            "</button>"
          )
          .join("");
        moveGroupSubmenuEl.classList.add("visible");
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

      function openGroupMenuAt(groupId, x, y) {
        hideAddMenu();
        hideThemeMenu();
        hideContextMenu();
        hidePickerMenu();
        state.groupMenu.visible = true;
        state.groupMenu.groupId = groupId;
        state.groupMenu.x = Math.max(8, Math.min(x, window.innerWidth - 160));
        state.groupMenu.y = Math.max(8, Math.min(y, window.innerHeight - 180));
        renderGroupMenu();
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

      function findSectionForBookmark(bookmarkId) {
        if (!state.data) return null;
        return state.data.sections.find((section) => section.items.some((item) => item.id === bookmarkId)) || null;
      }

      function hideContextMenu() {
        state.contextMenu.visible = false;
        state.contextMenu.bookmarkId = null;
        state.contextMoveGroupExpanded = false;
        moveGroupSubmenuEl.innerHTML = "";
        moveGroupSubmenuEl.classList.remove("visible");
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

      function hideThemeMenu() {
        themeMenuEl.classList.remove("visible");
        themeToggleEl.setAttribute("aria-expanded", "false");
      }

      function showQuickTooltip(anchorEl) {
        const text = anchorEl.dataset.quickTooltip;
        if (!text) return;
        window.clearTimeout(quickTooltipTimer);
        quickTooltipTimer = window.setTimeout(() => {
          const rect = anchorEl.getBoundingClientRect();
          quickTooltipEl.textContent = text;
          quickTooltipEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 228)) + "px";
          quickTooltipEl.style.top = Math.min(rect.bottom + 6, window.innerHeight - 32) + "px";
          quickTooltipEl.classList.add("visible");
        }, 120);
      }

      function hideQuickTooltip() {
        window.clearTimeout(quickTooltipTimer);
        quickTooltipEl.classList.remove("visible");
      }

      function toggleThemeMenu() {
        hideQuickTooltip();
        const nextVisible = !themeMenuEl.classList.contains("visible");
        hideAddMenu();
        hideContextMenu();
        hideGroupMenu();
        hidePickerMenu();
        if (nextVisible) {
          const rect = themeToggleEl.getBoundingClientRect();
          themeMenuEl.style.left = Math.max(8, Math.min(rect.right - 174, window.innerWidth - 182)) + "px";
          themeMenuEl.style.top = Math.min(rect.bottom + 6, window.innerHeight - 352) + "px";
        }
        themeMenuEl.classList.toggle("visible", nextVisible);
        themeToggleEl.setAttribute("aria-expanded", nextVisible ? "true" : "false");
      }

      function showGroupForm(mode, groupId) {
        state.groupFormVisible = true;
        state.groupFormMode = mode;
        state.editingGroupId = groupId || null;
        createGroupFormEl.classList.add("visible");
        hideAddMenu();
        hideThemeMenu();
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
        hideThemeMenu();
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

      function listMoveGroupTargets(sections, currentGroupId) {
        return sections.filter((section) => section.groupId !== currentGroupId);
      }

      function canDropBookmarkOnTarget(sourceId, targetId) {
        if (!sourceId || !targetId || sourceId === targetId) return false;
        const source = findBookmarkById(sourceId);
        const target = findBookmarkById(targetId);
        if (!source || !target) return false;
        return source.pinned === target.pinned;
      }

      function postBookmarkReorder(groupId, itemIds) {
        if (!state.draggingBookmarkId || itemIds.length === 0) return;
        if (groupId === state.draggingBookmarkGroupId) {
          post("reorderBookmarks", { groupId, itemIds });
          return;
        }
        post("moveBookmarkToGroupAndReorder", {
          id: state.draggingBookmarkId,
          groupId,
          itemIds
        });
      }

      function moveBookmarkWithinVisibleOrder(bookmarkId, direction) {
        const section = findSectionForBookmark(bookmarkId);
        if (!section) return;
        const currentIndex = section.items.findIndex((item) => item.id === bookmarkId);
        const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= section.items.length) return;
        const current = section.items[currentIndex];
        const target = section.items[targetIndex];
        if (!current || !target || current.pinned !== target.pinned) return;
        const itemIds = section.items.map((item) => item.id);
        itemIds[currentIndex] = target.id;
        itemIds[targetIndex] = current.id;
        post("reorderBookmarks", { groupId: section.groupId, itemIds });
      }

      function clearBookmarkDropIndicators() {
        document.querySelectorAll(".bookmark.is-drop-before, .bookmark.is-drop-after").forEach((item) => {
          item.classList.remove("is-drop-before", "is-drop-after");
          if (item instanceof HTMLElement) {
            delete item.dataset.dropPlacement;
          }
        });
        document.querySelectorAll(".section-bookmark-drop-target").forEach((item) => {
          item.classList.remove("section-bookmark-drop-target");
        });
        state.bookmarkDropGroupId = null;
      }

      function orderedBookmarkIdsAfterDrop(groupId, targetId, placement) {
        const section = findSectionByGroupId(groupId);
        if (!section || !state.draggingBookmarkId) return [];
        const nextIds = section.items.map((item) => item.id).filter((id) => id !== state.draggingBookmarkId);
        const targetIndex = nextIds.indexOf(targetId);
        if (targetIndex === -1) return [];
        nextIds.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, state.draggingBookmarkId);
        return nextIds;
      }

      function orderedBookmarkIdsForGroupAppend(groupId) {
        const section = findSectionByGroupId(groupId);
        const source = state.draggingBookmarkId ? findBookmarkById(state.draggingBookmarkId) : null;
        if (!section || !state.draggingBookmarkId || !source) return [];
        const nextIds = section.items.map((item) => item.id).filter((id) => id !== state.draggingBookmarkId);
        const sameTierLastIndex = section.items
          .filter((item) => item.id !== state.draggingBookmarkId)
          .map((item) => item.pinned === source.pinned)
          .lastIndexOf(true);
        if (sameTierLastIndex === -1) {
          if (source.pinned) {
            nextIds.unshift(state.draggingBookmarkId);
          } else {
            nextIds.push(state.draggingBookmarkId);
          }
          return nextIds;
        }
        nextIds.splice(sameTierLastIndex + 1, 0, state.draggingBookmarkId);
        return nextIds;
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
        const menuRect = contextMenuEl.getBoundingClientRect();
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
        const rightX = menuRect.right + 6;
        const leftX = menuRect.left - 226;
        state.pickerMenu.x = rightX + 220 <= window.innerWidth ? rightX : Math.max(8, leftX);
        state.pickerMenu.y = Math.max(8, Math.min(rect.top, window.innerHeight - 240));
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
	        const headerToggleTarget = target.closest("[data-group-header-toggle]");
	        const moveBookmarkTarget = target.closest("[data-move-bookmark]");
        const inlineActionTarget = target.closest("[data-inline-action]");
        const renameInputTarget = target.closest("[data-rename-input]");
        const addMenuTarget = target.closest("#btn-add-menu");
        const addMenuContentTarget = target.closest("#add-menu");
        const themeToggleTarget = target.closest("#theme-toggle");
        const themeMenuContentTarget = target.closest("#theme-menu");
        const themeOptionTarget = target.closest("[data-theme-option]");
        const feedbackToggleTarget = target.closest("#feedback-toggle");
        const openTarget = target.closest("[data-open]");

        if (feedbackToggleTarget instanceof HTMLElement) {
          hideQuickTooltip();
          post("openFeedback");
          hideAddMenu();
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          hideThemeMenu();
          return;
        }
        if (themeOptionTarget instanceof HTMLElement && themeOptionTarget.dataset.themeOption) {
          hideQuickTooltip();
          post("setThemeMode", { themeMode: themeOptionTarget.dataset.themeOption });
          hideThemeMenu();
          return;
        }
        if (themeToggleTarget instanceof HTMLElement) {
          toggleThemeMenu();
          return;
        }
        if (themeMenuContentTarget instanceof HTMLElement) {
          hideAddMenu();
          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          return;
        }

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
          hideThemeMenu();
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
          hideThemeMenu();
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
          hideThemeMenu();
          return;
        }
        if (sectionSortTarget instanceof HTMLElement && sectionSortTarget.dataset.sectionSort) {
          openSortPicker(sectionSortTarget.dataset.sectionSort, sectionSortTarget);
          hideContextMenu();
          hideGroupMenu();
          hideAddMenu();
          hideThemeMenu();
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
          hideThemeMenu();
          return;
        }
        if (menuTarget instanceof HTMLElement && menuTarget.dataset.menu) {
          const rect = menuTarget.getBoundingClientRect();
          hideAddMenu();
          hideThemeMenu();
          hideGroupMenu();
          hidePickerMenu();
          state.contextMoveGroupExpanded = false;
          state.contextMenu.visible = true;
          state.contextMenu.bookmarkId = menuTarget.dataset.menu;
          state.contextMenu.x = Math.max(8, Math.min(rect.left - 100, window.innerWidth - 160));
          state.contextMenu.y = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 248));
          renderContextMenu();
          return;
        }
        if (groupMenuTarget instanceof HTMLElement && groupMenuTarget.dataset.groupMenu) {
          const rect = groupMenuTarget.getBoundingClientRect();
          openGroupMenuAt(groupMenuTarget.dataset.groupMenu, rect.left - 100, rect.bottom + 6);
          return;
        }
	        if (
	          headerToggleTarget instanceof HTMLElement &&
	          headerToggleTarget.dataset.groupHeaderToggle &&
	          !target.closest(".section-meta")
	        ) {
	          if (state.suppressNextGroupToggle) {
	            state.suppressNextGroupToggle = false;
	            return;
	          }
	          post("toggleGroupCollapsed", {
	            groupId: headerToggleTarget.dataset.groupHeaderToggle,
	            collapsed: headerToggleTarget.dataset.nextCollapsed === "true"
	          });
	          hideContextMenu();
	          hideGroupMenu();
	          hidePickerMenu();
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
	          if (state.suppressNextOpen) {
	            state.suppressNextOpen = false;
	            return;
	          }
	          post("openBookmark", { id: openTarget.dataset.open });
	          hideContextMenu();
          hideGroupMenu();
          hidePickerMenu();
          hideAddMenu();
          hideThemeMenu();
          return;
        }
        hideContextMenu();
        hideGroupMenu();
        hidePickerMenu();
        hideAddMenu();
        hideThemeMenu();
      });

      document.body.addEventListener("contextmenu", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const bookmark = target.closest("[data-bookmark-id]");
        if (bookmark instanceof HTMLElement) {
          event.preventDefault();
          hideAddMenu();
          hideThemeMenu();
          hideGroupMenu();
          hidePickerMenu();
          state.contextMoveGroupExpanded = false;
          state.contextMenu.visible = true;
          state.contextMenu.bookmarkId = bookmark.dataset.bookmarkId;
          state.contextMenu.x = Math.min(event.clientX, window.innerWidth - 160);
          state.contextMenu.y = Math.max(8, Math.min(event.clientY, window.innerHeight - 248));
          renderContextMenu();
          return;
        }

        const groupHeader = target.closest("[data-group-header-toggle]");
        if (!(groupHeader instanceof HTMLElement) || !groupHeader.dataset.groupHeaderToggle) return;
        event.preventDefault();
        openGroupMenuAt(groupHeader.dataset.groupHeaderToggle, event.clientX, event.clientY);
      });

      contextMenuEl.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const moveGroupTarget = target.closest("[data-context-move-group]");
        if (moveGroupTarget instanceof HTMLElement && moveGroupTarget.dataset.contextMoveGroup) {
          const bookmarkId = moveGroupTarget.dataset.bookmarkId || state.contextMenu.bookmarkId;
          if (bookmarkId) {
            post("moveBookmarkToGroup", { id: bookmarkId, groupId: moveGroupTarget.dataset.contextMoveGroup });
          }
          hideContextMenu();
          return;
        }
        const actionTarget = target.closest("[data-menu-action]");
        const action = actionTarget instanceof HTMLElement ? actionTarget.dataset.menuAction : undefined;
        const bookmarkId = state.contextMenu.bookmarkId;
        if (!action || !bookmarkId) return;

        if (action === "open") post("openBookmark", { id: bookmarkId });
        if (action === "pin") post("togglePinned", { id: bookmarkId });
        if (action === "move-up") moveBookmarkWithinVisibleOrder(bookmarkId, "up");
        if (action === "move-down") moveBookmarkWithinVisibleOrder(bookmarkId, "down");
        if (action === "move-group") {
          state.contextMoveGroupExpanded = !state.contextMoveGroupExpanded;
          renderMoveGroupSubmenu(bookmarkId);
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
          hideContextMenu();
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
	        const bookmark = target.closest("[data-draggable-bookmark]");
	        if (bookmark instanceof HTMLElement && bookmark.dataset.draggableBookmark && bookmark.dataset.bookmarkGroup) {
	          state.draggingBookmarkId = bookmark.dataset.draggableBookmark;
	          state.draggingBookmarkGroupId = bookmark.dataset.bookmarkGroup;
	          state.suppressNextOpen = false;
	          bookmark.classList.add("is-dragging");
	          if (event.dataTransfer) {
	            event.dataTransfer.effectAllowed = "move";
	            event.dataTransfer.setData("application/x-jumpjump-bookmark", state.draggingBookmarkId);
	          }
	          return;
	        }
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
	        if (state.draggingBookmarkId) {
	          state.suppressNextOpen = true;
	          window.setTimeout(() => {
	            state.suppressNextOpen = false;
	          }, 120);
	        }
	        if (state.draggingGroupId) {
	          state.suppressNextGroupToggle = true;
	          window.setTimeout(() => {
	            state.suppressNextGroupToggle = false;
	          }, 120);
	        }
	        state.draggingGroupId = null;
	        state.draggingBookmarkId = null;
	        state.draggingBookmarkGroupId = null;
	        clearBookmarkDropIndicators();
	        render();
	      });

		      sectionsEl.addEventListener("dragover", (event) => {
		        const target = event.target;
		        if (!(target instanceof HTMLElement)) return;
		        if (state.draggingBookmarkId) {
		          const bookmark = target.closest("[data-bookmark-id]");
		          if (bookmark instanceof HTMLElement && bookmark.dataset.bookmarkId && bookmark.dataset.bookmarkGroup) {
		            if (!canDropBookmarkOnTarget(state.draggingBookmarkId, bookmark.dataset.bookmarkId)) return;
		            event.preventDefault();
		            if (event.dataTransfer) {
		              event.dataTransfer.dropEffect = "move";
		            }
		            const rect = bookmark.getBoundingClientRect();
		            const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
		            clearBookmarkDropIndicators();
		            state.bookmarkDropGroupId = bookmark.dataset.bookmarkGroup;
		            bookmark.dataset.dropPlacement = placement;
		            bookmark.classList.add(placement === "after" ? "is-drop-after" : "is-drop-before");
		            return;
		          }
		          const bookmarkSection = target.closest("[data-section-group]");
		          if (!(bookmarkSection instanceof HTMLElement) || !bookmarkSection.dataset.sectionGroup) return;
		          event.preventDefault();
		          if (event.dataTransfer) {
		            event.dataTransfer.dropEffect = "move";
		          }
		          clearBookmarkDropIndicators();
		          state.bookmarkDropGroupId = bookmarkSection.dataset.sectionGroup;
		          bookmarkSection.classList.add("section-bookmark-drop-target");
		          return;
		        }
		        const section = target.closest("[data-section-group]");
		        if (!(section instanceof HTMLElement)) return;
	        const groupId = section.dataset.sectionGroup;
        if (!state.draggingGroupId || !groupId || groupId === "${UNGROUPED_GROUP_ID}" || groupId === state.draggingGroupId) return;
        event.preventDefault();
      });

		      sectionsEl.addEventListener("drop", (event) => {
		        const target = event.target;
		        if (!(target instanceof HTMLElement)) return;
		        if (state.draggingBookmarkId) {
		          const bookmark = target.closest("[data-bookmark-id]");
		          if (bookmark instanceof HTMLElement && bookmark.dataset.bookmarkId && bookmark.dataset.bookmarkGroup) {
		            if (!canDropBookmarkOnTarget(state.draggingBookmarkId, bookmark.dataset.bookmarkId)) return;
		            event.preventDefault();
		            const placement = bookmark.dataset.dropPlacement === "after" ? "after" : "before";
		            const itemIds = orderedBookmarkIdsAfterDrop(bookmark.dataset.bookmarkGroup, bookmark.dataset.bookmarkId, placement);
		            postBookmarkReorder(bookmark.dataset.bookmarkGroup, itemIds);
		            state.draggingBookmarkId = null;
		            state.draggingBookmarkGroupId = null;
		            clearBookmarkDropIndicators();
		            return;
		          }
		          const bookmarkSection = target.closest("[data-section-group]");
		          if (!(bookmarkSection instanceof HTMLElement) || !bookmarkSection.dataset.sectionGroup) return;
		          event.preventDefault();
		          const itemIds = orderedBookmarkIdsForGroupAppend(bookmarkSection.dataset.sectionGroup);
		          postBookmarkReorder(bookmarkSection.dataset.sectionGroup, itemIds);
		          state.draggingBookmarkId = null;
		          state.draggingBookmarkGroupId = null;
		          clearBookmarkDropIndicators();
		          return;
	        }
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
        hideThemeMenu();
        hideGroupMenu();
        hidePickerMenu();
        post("toggleLanguage");
      });

      compactToggleEl.addEventListener("click", () => {
        hideAddMenu();
        hideThemeMenu();
        hideGroupMenu();
        hidePickerMenu();
        post("toggleCompactMode");
      });

      [themeToggleEl, feedbackToggleEl].forEach((button) => {
        button.addEventListener("mouseenter", () => showQuickTooltip(button));
        button.addEventListener("mouseleave", hideQuickTooltip);
        button.addEventListener("focus", () => showQuickTooltip(button));
        button.addEventListener("blur", hideQuickTooltip);
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
        hideQuickTooltip();
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
        min-width: 304px;
        overflow-x: auto;
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
