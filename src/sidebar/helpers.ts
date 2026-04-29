// Copyright 2026 Xinwei
// SPDX-License-Identifier: Apache-2.0

import type { BookmarkGroup, BookmarkItem } from "../types";

const typeSortRank: Record<BookmarkItem["type"], number> = {
  folder: 0,
  file: 1,
  line: 2
};

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
        result = typeSortRank[a.type] - typeSortRank[b.type];
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
