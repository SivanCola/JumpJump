// Copyright 2026 Xinwei
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { BookmarkFile, BookmarkGroup, BookmarkItem, BookmarkSortBy, BookmarkSortDirection, BookmarkType } from "../types";
import {
  BOOKMARKS_DIR,
  BOOKMARKS_FILE,
  UNGROUPED_GROUP_ID,
  createEmptyBookmarkFile,
  createGroupId,
  normalizeBookmarkFile,
  normalizeBookmarkItem,
  normalizeRelativePath,
  validateBookmarkFile
} from "./schema";

export class BookmarkStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly workspaceRoot: string) {}

  get configDirPath(): string {
    return path.join(this.workspaceRoot, BOOKMARKS_DIR);
  }

  get configPath(): string {
    return path.join(this.configDirPath, BOOKMARKS_FILE);
  }

  resolveAbsolutePath(relativePath: string): string {
    return path.resolve(this.workspaceRoot, relativePath);
  }

  toRelativePath(absolutePath: string): string {
    const relativePath = path.relative(this.workspaceRoot, absolutePath);
    return normalizeRelativePath(relativePath || ".");
  }

  isPathInsideWorkspace(absolutePath: string): boolean {
    const relativePath = path.relative(this.workspaceRoot, absolutePath);
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  }

  async ensureInitialized(): Promise<BookmarkFile> {
    return this.enqueueMutation(() => this.ensureInitializedUnlocked());
  }

  async read(): Promise<BookmarkFile> {
    await this.mutationQueue;
    return this.readUnlocked();
  }

  async write(bookmarks: BookmarkFile): Promise<void> {
    await this.enqueueMutation(() => this.writeUnlocked(bookmarks));
  }

  private async ensureInitializedUnlocked(): Promise<BookmarkFile> {
    try {
      return await this.readUnlocked();
    } catch (error) {
      if (isFileMissingError(error)) {
        const emptyFile = createEmptyBookmarkFile();
        await this.writeUnlocked(emptyFile);
        return emptyFile;
      }
      throw error;
    }
  }

  private async readUnlocked(): Promise<BookmarkFile> {
    const raw = await fs.readFile(this.configPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`书签配置 JSON 解析失败: ${(error as Error).message}`);
    }
    return validateBookmarkFile(parsed);
  }

  private async writeUnlocked(bookmarks: BookmarkFile): Promise<void> {
    await fs.mkdir(this.configDirPath, { recursive: true });
    const normalized = normalizeBookmarkFile(bookmarks);
    await fs.writeFile(this.configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async addBookmark(input: {
    type: BookmarkType;
    label: string;
    absolutePath: string;
    line?: number;
    groupId?: string;
    description?: string;
  }): Promise<BookmarkItem> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const groupId = this.ensureExistingGroupId(bookmarks, input.groupId);
      const now = new Date().toISOString();
      const item = normalizeBookmarkItem({
        id: randomUUID(),
        type: input.type,
        label: input.label,
        path: this.toRelativePath(input.absolutePath),
        line: input.line,
        groupId,
        description: input.description,
        createdAt: now,
        updatedAt: now,
        manualOrder: getNextManualOrder(bookmarks.items, groupId)
      });

      bookmarks.items.push(item);
      await this.writeUnlocked(bookmarks);
      return item;
    });
  }

  async renameBookmark(id: string, label: string): Promise<BookmarkItem | undefined> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const target = bookmarks.items.find((item) => item.id === id);
      if (!target) {
        return undefined;
      }
      target.label = label.trim();
      target.updatedAt = new Date().toISOString();
      await this.writeUnlocked(bookmarks);
      return target;
    });
  }

  async togglePinned(id: string): Promise<BookmarkItem | undefined> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const target = bookmarks.items.find((item) => item.id === id);
      if (!target) {
        return undefined;
      }
      target.pinned = target.pinned ? undefined : true;
      target.updatedAt = new Date().toISOString();
      await this.writeUnlocked(bookmarks);
      return target;
    });
  }

  async markOpened(id: string): Promise<BookmarkItem | undefined> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const target = bookmarks.items.find((item) => item.id === id);
      if (!target) {
        return undefined;
      }
      target.lastOpenedAt = new Date().toISOString();
      await this.writeUnlocked(bookmarks);
      return target;
    });
  }

  async moveBookmarkToGroup(id: string, groupId: string): Promise<BookmarkItem | undefined> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const target = bookmarks.items.find((item) => item.id === id);
      if (!target) {
        return undefined;
      }
      const resolvedGroupId = this.ensureExistingGroupId(bookmarks, groupId);
      if (target.groupId === resolvedGroupId) {
        return target;
      }
      target.groupId = resolvedGroupId;
      target.manualOrder = getNextManualOrder(bookmarks.items.filter((item) => item.id !== id), resolvedGroupId);
      target.updatedAt = new Date().toISOString();
      await this.writeUnlocked(bookmarks);
      return target;
    });
  }

  async moveBookmarkWithinGroup(id: string, direction: "up" | "down"): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const target = bookmarks.items.find((item) => item.id === id);
      if (!target) {
        return false;
      }
      const group = bookmarks.groups.find((entry) => entry.id === target.groupId);
      if (!group || group.sortBy !== "manual") {
        return false;
      }
      const groupItems = sortManualGroupItemsForMovement(bookmarks.items.filter((item) => item.groupId === target.groupId));
      const index = groupItems.findIndex((item) => item.id === id);
      if (index === -1) {
        return false;
      }
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= groupItems.length) {
        return false;
      }
      const current = groupItems[index];
      const other = groupItems[swapIndex];
      if ((current.pinned === true) !== (other.pinned === true)) {
        return false;
      }
      const nextOrder = current.manualOrder;
      current.manualOrder = other.manualOrder;
      other.manualOrder = nextOrder;
      current.updatedAt = new Date().toISOString();
      other.updatedAt = new Date().toISOString();
      await this.writeUnlocked(bookmarks);
      return true;
    });
  }

  async reorderBookmarksInGroup(groupId: string, itemIds: string[]): Promise<void> {
    await this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const group = bookmarks.groups.find((entry) => entry.id === groupId);
      if (!group) {
        return;
      }

      const groupItems = bookmarks.items.filter((item) => item.groupId === groupId);
      const allowedIds = new Set(groupItems.map((item) => item.id));
      const nextIds = itemIds.filter((id) => allowedIds.has(id));
      if (nextIds.length !== groupItems.length) {
        throw new Error("书签排序数据不完整。");
      }

      group.sortBy = "manual";
      group.sortDirection = "asc";
      const now = new Date().toISOString();
      nextIds.forEach((id, index) => {
        const item = groupItems.find((entry) => entry.id === id);
        if (item) {
          item.manualOrder = index;
          item.updatedAt = now;
        }
      });
      await this.writeUnlocked(bookmarks);
    });
  }

  async moveBookmarkToGroupAndReorder(id: string, groupId: string, itemIds: string[]): Promise<void> {
    await this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const target = bookmarks.items.find((item) => item.id === id);
      if (!target) {
        return;
      }
      const resolvedGroupId = this.ensureExistingGroupId(bookmarks, groupId);
      const group = bookmarks.groups.find((entry) => entry.id === resolvedGroupId);
      if (!group) {
        return;
      }

      const targetGroupItems = bookmarks.items.filter((item) => item.groupId === resolvedGroupId && item.id !== id);
      const allowedIds = new Set([...targetGroupItems.map((item) => item.id), id]);
      const nextIds = itemIds.filter((itemId) => allowedIds.has(itemId));
      if (nextIds.length !== targetGroupItems.length + 1 || !nextIds.includes(id)) {
        throw new Error("书签排序数据不完整。");
      }

      target.groupId = resolvedGroupId;
      group.sortBy = "manual";
      group.sortDirection = "asc";
      const now = new Date().toISOString();
      nextIds.forEach((itemId, index) => {
        const item = bookmarks.items.find((entry) => entry.id === itemId);
        if (item) {
          item.groupId = resolvedGroupId;
          item.manualOrder = index;
          item.updatedAt = now;
        }
      });
      await this.writeUnlocked(bookmarks);
    });
  }

  async createGroup(name: string): Promise<BookmarkGroup> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const normalizedName = name.trim();
      if (!normalizedName) {
        throw new Error("分组名称不能为空。");
      }
      const existingNames = new Set(bookmarks.groups.map((group) => group.name));
      if (existingNames.has(normalizedName)) {
        throw new Error("分组名称已存在。");
      }
      const existingIds = new Set(bookmarks.groups.map((group) => group.id));
      let nextId = createGroupId(normalizedName);
      let suffix = 2;
      while (existingIds.has(nextId)) {
        nextId = `${createGroupId(normalizedName)}-${suffix}`;
        suffix += 1;
      }

      const group: BookmarkGroup = {
        id: nextId,
        name: normalizedName,
        order: getNextGroupOrder(bookmarks.groups),
        collapsed: false,
        sortBy: "manual",
        sortDirection: "asc"
      };
      bookmarks.groups.push(group);
      await this.writeUnlocked(bookmarks);
      return group;
    });
  }

  async renameGroup(groupId: string, name: string): Promise<BookmarkGroup | undefined> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const group = bookmarks.groups.find((entry) => entry.id === groupId);
      if (!group || group.system) {
        return undefined;
      }
      const normalizedName = name.trim();
      if (!normalizedName) {
        throw new Error("分组名称不能为空。");
      }
      if (bookmarks.groups.some((entry) => entry.id !== groupId && entry.name === normalizedName)) {
        throw new Error("分组名称已存在。");
      }
      group.name = normalizedName;
      await this.writeUnlocked(bookmarks);
      return group;
    });
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      if (groupId === UNGROUPED_GROUP_ID) {
        return false;
      }
      const bookmarks = await this.ensureInitializedUnlocked();
      const groupIndex = bookmarks.groups.findIndex((entry) => entry.id === groupId);
      if (groupIndex === -1) {
        return false;
      }
      bookmarks.groups.splice(groupIndex, 1);
      for (const item of bookmarks.items) {
        if (item.groupId === groupId) {
          item.groupId = UNGROUPED_GROUP_ID;
          item.manualOrder = getNextManualOrder(bookmarks.items.filter((entry) => entry.id !== item.id), UNGROUPED_GROUP_ID);
          item.updatedAt = new Date().toISOString();
        }
      }
      reindexGroups(bookmarks.groups);
      await this.writeUnlocked(bookmarks);
      return true;
    });
  }

  async setGroupCollapsed(groupId: string, collapsed: boolean): Promise<BookmarkGroup | undefined> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const group = bookmarks.groups.find((entry) => entry.id === groupId);
      if (!group) {
        return undefined;
      }
      group.collapsed = collapsed;
      await this.writeUnlocked(bookmarks);
      return group;
    });
  }

  async setGroupSort(
    groupId: string,
    sortBy: BookmarkSortBy,
    sortDirection: BookmarkSortDirection
  ): Promise<BookmarkGroup | undefined> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const group = bookmarks.groups.find((entry) => entry.id === groupId);
      if (!group) {
        return undefined;
      }
      group.sortBy = sortBy;
      group.sortDirection = sortDirection;
      await this.writeUnlocked(bookmarks);
      return group;
    });
  }

  async reorderGroups(groupIds: string[]): Promise<void> {
    await this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const customGroups = bookmarks.groups.filter((group) => !group.system);
      const allowedIds = new Set(customGroups.map((group) => group.id));
      const nextIds = groupIds.filter((id) => allowedIds.has(id));
      if (nextIds.length !== customGroups.length) {
        throw new Error("分组排序数据不完整。");
      }
      nextIds.forEach((id, index) => {
        const group = customGroups.find((entry) => entry.id === id);
        if (group) {
          group.order = index + 1;
        }
      });
      await this.writeUnlocked(bookmarks);
    });
  }

  async deleteBookmark(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const nextItems = bookmarks.items.filter((item) => item.id !== id);
      if (nextItems.length === bookmarks.items.length) {
        return false;
      }
      bookmarks.items = nextItems;
      await this.writeUnlocked(bookmarks);
      return true;
    });
  }

  async removeMissingBookmarks(): Promise<number> {
    return this.enqueueMutation(async () => {
      const bookmarks = await this.ensureInitializedUnlocked();
      const results = await Promise.all(
        bookmarks.items.map(async (item) => ({
          item,
          exists: await pathExists(this.resolveAbsolutePath(item.path))
        }))
      );
      const nextItems = results.filter((entry) => entry.exists).map((entry) => entry.item);
      const removedCount = bookmarks.items.length - nextItems.length;
      if (removedCount > 0) {
        bookmarks.items = nextItems;
        await this.writeUnlocked(bookmarks);
      }
      return removedCount;
    });
  }

  private ensureExistingGroupId(bookmarks: BookmarkFile, groupId?: string): string {
    if (!groupId || !bookmarks.groups.some((group) => group.id === groupId)) {
      return UNGROUPED_GROUP_ID;
    }
    return groupId;
  }
}

function getNextManualOrder(items: BookmarkItem[], groupId: string): number {
  const max = items.filter((item) => item.groupId === groupId).reduce((highest, item) => Math.max(highest, item.manualOrder), -1);
  return max + 1;
}

function getNextGroupOrder(groups: BookmarkGroup[]): number {
  const customGroups = groups.filter((group) => !group.system);
  return customGroups.reduce((highest, group) => Math.max(highest, group.order), 0) + 1;
}

function reindexGroups(groups: BookmarkGroup[]): void {
  groups
    .filter((group) => !group.system)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN"))
    .forEach((group, index) => {
      group.order = index + 1;
    });
}

function sortManualGroupItemsForMovement(items: BookmarkItem[]): BookmarkItem[] {
  return [...items].sort((a, b) => {
    if ((a.pinned === true) !== (b.pinned === true)) {
      return a.pinned === true ? -1 : 1;
    }
    return a.manualOrder - b.manualOrder || a.createdAt.localeCompare(b.createdAt);
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

function isFileMissingError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}
