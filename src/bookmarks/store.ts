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
  constructor(private readonly workspaceRoot: string) {}

  get configDirPath(): string {
    return path.join(this.workspaceRoot, BOOKMARKS_DIR);
  }

  get configPath(): string {
    return path.join(this.configDirPath, BOOKMARKS_FILE);
  }

  resolveAbsolutePath(relativePath: string): string {
    return path.join(this.workspaceRoot, relativePath);
  }

  toRelativePath(absolutePath: string): string {
    return normalizeRelativePath(path.relative(this.workspaceRoot, absolutePath));
  }

  async ensureInitialized(): Promise<BookmarkFile> {
    try {
      return await this.read();
    } catch (error) {
      if (isFileMissingError(error)) {
        const emptyFile = createEmptyBookmarkFile();
        await this.write(emptyFile);
        return emptyFile;
      }
      throw error;
    }
  }

  async read(): Promise<BookmarkFile> {
    const raw = await fs.readFile(this.configPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`书签配置 JSON 解析失败: ${(error as Error).message}`);
    }
    return validateBookmarkFile(parsed);
  }

  async write(bookmarks: BookmarkFile): Promise<void> {
    await fs.mkdir(this.configDirPath, { recursive: true });
    const normalized = normalizeBookmarkFile(bookmarks);
    await fs.writeFile(this.configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }

  async addBookmark(input: {
    type: BookmarkType;
    label: string;
    absolutePath: string;
    line?: number;
    groupId?: string;
    description?: string;
  }): Promise<BookmarkItem> {
    const bookmarks = await this.ensureInitialized();
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
    await this.write(bookmarks);
    return item;
  }

  async renameBookmark(id: string, label: string): Promise<BookmarkItem | undefined> {
    const bookmarks = await this.read();
    const target = bookmarks.items.find((item) => item.id === id);
    if (!target) {
      return undefined;
    }
    target.label = label.trim();
    target.updatedAt = new Date().toISOString();
    await this.write(bookmarks);
    return target;
  }

  async togglePinned(id: string): Promise<BookmarkItem | undefined> {
    const bookmarks = await this.read();
    const target = bookmarks.items.find((item) => item.id === id);
    if (!target) {
      return undefined;
    }
    target.pinned = target.pinned ? undefined : true;
    target.updatedAt = new Date().toISOString();
    await this.write(bookmarks);
    return target;
  }

  async markOpened(id: string): Promise<BookmarkItem | undefined> {
    const bookmarks = await this.read();
    const target = bookmarks.items.find((item) => item.id === id);
    if (!target) {
      return undefined;
    }
    target.lastOpenedAt = new Date().toISOString();
    await this.write(bookmarks);
    return target;
  }

  async moveBookmarkToGroup(id: string, groupId: string): Promise<BookmarkItem | undefined> {
    const bookmarks = await this.read();
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
    await this.write(bookmarks);
    return target;
  }

  async moveBookmarkWithinGroup(id: string, direction: "up" | "down"): Promise<boolean> {
    const bookmarks = await this.read();
    const target = bookmarks.items.find((item) => item.id === id);
    if (!target) {
      return false;
    }
    const group = bookmarks.groups.find((entry) => entry.id === target.groupId);
    if (!group || group.sortBy !== "manual") {
      return false;
    }
    const groupItems = bookmarks.items
      .filter((item) => item.groupId === target.groupId)
      .sort((a, b) => a.manualOrder - b.manualOrder || a.createdAt.localeCompare(b.createdAt));
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
    const nextOrder = current.manualOrder;
    current.manualOrder = other.manualOrder;
    other.manualOrder = nextOrder;
    current.updatedAt = new Date().toISOString();
    other.updatedAt = new Date().toISOString();
    await this.write(bookmarks);
    return true;
  }

  async createGroup(name: string): Promise<BookmarkGroup> {
    const bookmarks = await this.ensureInitialized();
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
    await this.write(bookmarks);
    return group;
  }

  async renameGroup(groupId: string, name: string): Promise<BookmarkGroup | undefined> {
    const bookmarks = await this.read();
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
    await this.write(bookmarks);
    return group;
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    if (groupId === UNGROUPED_GROUP_ID) {
      return false;
    }
    const bookmarks = await this.read();
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
    await this.write(bookmarks);
    return true;
  }

  async setGroupCollapsed(groupId: string, collapsed: boolean): Promise<BookmarkGroup | undefined> {
    const bookmarks = await this.read();
    const group = bookmarks.groups.find((entry) => entry.id === groupId);
    if (!group) {
      return undefined;
    }
    group.collapsed = collapsed;
    await this.write(bookmarks);
    return group;
  }

  async setGroupSort(
    groupId: string,
    sortBy: BookmarkSortBy,
    sortDirection: BookmarkSortDirection
  ): Promise<BookmarkGroup | undefined> {
    const bookmarks = await this.read();
    const group = bookmarks.groups.find((entry) => entry.id === groupId);
    if (!group) {
      return undefined;
    }
    group.sortBy = sortBy;
    group.sortDirection = sortDirection;
    await this.write(bookmarks);
    return group;
  }

  async reorderGroups(groupIds: string[]): Promise<void> {
    const bookmarks = await this.read();
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
    await this.write(bookmarks);
  }

  async deleteBookmark(id: string): Promise<boolean> {
    const bookmarks = await this.read();
    const nextItems = bookmarks.items.filter((item) => item.id !== id);
    if (nextItems.length === bookmarks.items.length) {
      return false;
    }
    bookmarks.items = nextItems;
    await this.write(bookmarks);
    return true;
  }

  async removeMissingBookmarks(): Promise<number> {
    const bookmarks = await this.read();
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
      await this.write(bookmarks);
    }
    return removedCount;
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
