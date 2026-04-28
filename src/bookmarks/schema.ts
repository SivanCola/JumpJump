// Copyright 2026 Xinwei
// SPDX-License-Identifier: Apache-2.0

import { BookmarkFile, BookmarkGroup, BookmarkItem, BookmarkSortBy, BookmarkSortDirection, BookmarkType } from "../types";

export const BOOKMARKS_VERSION = 2;
export const BOOKMARKS_DIR = ".jumpjump";
export const BOOKMARKS_FILE = "bookmarks.json";
export const UNGROUPED_GROUP_ID = "ungrouped";

type LegacyBookmarkItem = {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  path?: unknown;
  line?: unknown;
  group?: unknown;
  description?: unknown;
  pinned?: unknown;
  lastOpenedAt?: unknown;
};

type LegacyBookmarkFile = {
  version?: unknown;
  groups?: unknown;
  items?: unknown;
};

export function createDefaultUngroupedGroup(): BookmarkGroup {
  return {
    id: UNGROUPED_GROUP_ID,
    name: "未分组",
    order: 0,
    collapsed: false,
    sortBy: "createdAt",
    sortDirection: "desc",
    system: true
  };
}

export function createEmptyBookmarkFile(): BookmarkFile {
  return {
    version: BOOKMARKS_VERSION,
    groups: [createDefaultUngroupedGroup()],
    items: []
  };
}

export function normalizeRelativePath(inputPath: string): string {
  const normalized = inputPath.replace(/[\\/]+/g, "/");
  return normalized.replace(/^\.\/+/, "");
}

export function sanitizeLine(line?: number): number | undefined {
  if (typeof line !== "number" || Number.isNaN(line) || line < 1) {
    return undefined;
  }
  return Math.floor(line);
}

export function sanitizeSortBy(value?: string): BookmarkSortBy {
  return value === "manual" || value === "label" || value === "createdAt" || value === "updatedAt" || value === "type"
    ? value
    : "manual";
}

export function sanitizeSortDirection(value?: string): BookmarkSortDirection {
  return value === "desc" ? "desc" : "asc";
}

export function normalizeBookmarkItem(item: BookmarkItem): BookmarkItem {
  return {
    ...item,
    path: normalizeRelativePath(item.path),
    line: sanitizeLine(item.line),
    groupId: item.groupId?.trim() || UNGROUPED_GROUP_ID,
    description: item.description?.trim() || undefined,
    pinned: item.pinned === true ? true : undefined,
    lastOpenedAt: normalizeIsoDate(item.lastOpenedAt),
    createdAt: normalizeRequiredIsoDate(item.createdAt),
    updatedAt: normalizeRequiredIsoDate(item.updatedAt),
    manualOrder: sanitizeOrder(item.manualOrder)
  };
}

export function normalizeBookmarkGroup(group: BookmarkGroup, fallbackOrder = 0): BookmarkGroup {
  const isUngrouped = group.id === UNGROUPED_GROUP_ID || group.system === true;
  const sortBy =
    typeof group.sortBy === "string"
      ? sanitizeSortBy(group.sortBy)
      : isUngrouped
        ? "createdAt"
        : "manual";
  const sortDirection =
    typeof group.sortDirection === "string"
      ? sanitizeSortDirection(group.sortDirection)
      : isUngrouped
        ? "desc"
        : "asc";
  return {
    id: isUngrouped ? UNGROUPED_GROUP_ID : group.id.trim(),
    name: (isUngrouped ? "未分组" : group.name)?.trim() || "未分组",
    order: isUngrouped ? 0 : sanitizeOrder(group.order, fallbackOrder),
    collapsed: group.collapsed === true,
    sortBy,
    sortDirection,
    system: isUngrouped ? true : undefined
  };
}

export function validateBookmarkFile(input: unknown): BookmarkFile {
  if (!input || typeof input !== "object") {
    throw new Error("书签配置必须是一个 JSON 对象。");
  }

  const candidate = input as LegacyBookmarkFile;
  if (candidate.version === 1) {
    return migrateLegacyBookmarkFile(candidate);
  }
  if (candidate.version !== BOOKMARKS_VERSION) {
    throw new Error(`暂不支持的书签配置版本: ${String(candidate.version)}`);
  }
  if (!Array.isArray(candidate.groups)) {
    throw new Error("groups 字段必须是数组。");
  }
  if (!Array.isArray(candidate.items)) {
    throw new Error("items 字段必须是数组。");
  }

  const groups = candidate.groups.map((group, index) => validateBookmarkGroup(group, index));
  const items = candidate.items.map((item, index) => validateBookmarkItem(item, index));
  return normalizeBookmarkFile({ version: BOOKMARKS_VERSION, groups, items });
}

export function normalizeBookmarkFile(file: BookmarkFile): BookmarkFile {
  const normalizedGroups = ensureGroupDefaults(
    file.groups.map((group, index) => normalizeBookmarkGroup(group, index + 1))
  );
  const groupIds = new Set(normalizedGroups.map((group) => group.id));
  const normalizedItems = file.items.map((item) =>
    normalizeBookmarkItem({
      ...item,
      groupId: groupIds.has(item.groupId) ? item.groupId : UNGROUPED_GROUP_ID
    })
  );

  return {
    version: BOOKMARKS_VERSION,
    groups: normalizedGroups,
    items: normalizedItems
  };
}

function validateBookmarkGroup(input: unknown, index: number): BookmarkGroup {
  if (!input || typeof input !== "object") {
    throw new Error(`第 ${index + 1} 个分组不是对象。`);
  }

  const candidate = input as Partial<BookmarkGroup>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    throw new Error(`第 ${index + 1} 个分组缺少 id。`);
  }
  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    throw new Error(`第 ${index + 1} 个分组缺少 name。`);
  }

  return normalizeBookmarkGroup(
    {
      id: candidate.id.trim(),
      name: candidate.name.trim(),
      order: typeof candidate.order === "number" ? candidate.order : index + 1,
      collapsed: candidate.collapsed === true,
      sortBy: sanitizeSortBy(candidate.sortBy),
      sortDirection: sanitizeSortDirection(candidate.sortDirection),
      system: candidate.system === true
    },
    index + 1
  );
}

function validateBookmarkItem(input: unknown, index: number): BookmarkItem {
  if (!input || typeof input !== "object") {
    throw new Error(`第 ${index + 1} 条书签不是对象。`);
  }

  const candidate = input as Partial<BookmarkItem>;
  const type = candidate.type;
  if (type !== "folder" && type !== "file" && type !== "line") {
    throw new Error(`第 ${index + 1} 条书签 type 非法。`);
  }
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 id。`);
  }
  if (typeof candidate.label !== "string" || !candidate.label.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 label。`);
  }
  if (typeof candidate.path !== "string" || !candidate.path.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 path。`);
  }
  if (type === "line" && sanitizeLine(candidate.line) === undefined) {
    throw new Error(`第 ${index + 1} 条行号书签缺少有效 line。`);
  }
  if (typeof candidate.groupId !== "string" || !candidate.groupId.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 groupId。`);
  }
  if (typeof candidate.createdAt !== "string" || !candidate.createdAt.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 createdAt。`);
  }
  if (typeof candidate.updatedAt !== "string" || !candidate.updatedAt.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 updatedAt。`);
  }

  return normalizeBookmarkItem({
    id: candidate.id.trim(),
    type: type as BookmarkType,
    label: candidate.label.trim(),
    path: candidate.path.trim(),
    line: candidate.line,
    groupId: candidate.groupId.trim(),
    description: candidate.description,
    pinned: candidate.pinned,
    lastOpenedAt: typeof candidate.lastOpenedAt === "string" ? candidate.lastOpenedAt : undefined,
    createdAt: candidate.createdAt.trim(),
    updatedAt: candidate.updatedAt.trim(),
    manualOrder: typeof candidate.manualOrder === "number" ? candidate.manualOrder : index
  });
}

function migrateLegacyBookmarkFile(legacy: LegacyBookmarkFile): BookmarkFile {
  if (!Array.isArray(legacy.items)) {
    throw new Error("items 字段必须是数组。");
  }

  const now = new Date().toISOString();
  const customGroups = new Map<string, BookmarkGroup>();
  const items = legacy.items.map((item, index) => {
    const normalized = migrateLegacyBookmarkItem(item as LegacyBookmarkItem, index, now);
    if (normalized.groupId !== UNGROUPED_GROUP_ID && !customGroups.has(normalized.groupId)) {
      customGroups.set(normalized.groupId, {
        id: normalized.groupId,
        name: legacyGroupName((item as LegacyBookmarkItem).group) ?? "未命名分组",
        order: customGroups.size + 1,
        collapsed: false,
        sortBy: "manual",
        sortDirection: "asc"
      });
    }
    return normalized;
  });

  return normalizeBookmarkFile({
    version: BOOKMARKS_VERSION,
    groups: [createDefaultUngroupedGroup(), ...customGroups.values()],
    items
  });
}

function migrateLegacyBookmarkItem(input: LegacyBookmarkItem, index: number, now: string): BookmarkItem {
  const type = input.type;
  if (type !== "folder" && type !== "file" && type !== "line") {
    throw new Error(`第 ${index + 1} 条书签 type 非法。`);
  }
  if (typeof input.id !== "string" || !input.id.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 id。`);
  }
  if (typeof input.label !== "string" || !input.label.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 label。`);
  }
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new Error(`第 ${index + 1} 条书签缺少 path。`);
  }
  if (type === "line" && sanitizeLine(typeof input.line === "number" ? input.line : undefined) === undefined) {
    throw new Error(`第 ${index + 1} 条行号书签缺少有效 line。`);
  }

  const groupName = legacyGroupName(input.group);
  return normalizeBookmarkItem({
    id: input.id.trim(),
    type,
    label: input.label.trim(),
    path: input.path.trim(),
    line: typeof input.line === "number" ? input.line : undefined,
    groupId: groupName ? createGroupId(groupName) : UNGROUPED_GROUP_ID,
    description: typeof input.description === "string" ? input.description : undefined,
    pinned: input.pinned === true,
    lastOpenedAt: typeof input.lastOpenedAt === "string" ? input.lastOpenedAt : undefined,
    createdAt: now,
    updatedAt: now,
    manualOrder: index
  });
}

function legacyGroupName(input: unknown): string | undefined {
  return typeof input === "string" && input.trim() ? input.trim() : undefined;
}

function ensureGroupDefaults(groups: BookmarkGroup[]): BookmarkGroup[] {
  const normalized = new Map<string, BookmarkGroup>();
  for (const group of groups) {
    normalized.set(group.id, group);
  }
  if (!normalized.has(UNGROUPED_GROUP_ID)) {
    normalized.set(UNGROUPED_GROUP_ID, createDefaultUngroupedGroup());
  }

  const ungrouped = normalizeBookmarkGroup(normalized.get(UNGROUPED_GROUP_ID) ?? createDefaultUngroupedGroup(), 0);

  const customGroups = [...normalized.values()]
    .filter((group) => group.id !== UNGROUPED_GROUP_ID)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN"))
    .map((group, index) => normalizeBookmarkGroup({ ...group, order: index + 1 }, index + 1));

  return [ungrouped, ...customGroups];
}

function sanitizeOrder(value?: number, fallback = 0): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeRequiredIsoDate(value?: string): string {
  const normalized = normalizeIsoDate(value);
  return normalized ?? new Date().toISOString();
}

function normalizeIsoDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function createGroupId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base ? `group-${base}` : `group-${Date.now()}`;
}
