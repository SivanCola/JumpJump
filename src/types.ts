// Copyright 2026 Xinwei
// SPDX-License-Identifier: Apache-2.0

export type BookmarkType = "folder" | "file" | "line";
export type BookmarkSortBy = "manual" | "label" | "createdAt" | "updatedAt" | "type";
export type BookmarkSortDirection = "asc" | "desc";

export interface BookmarkGroup {
  id: string;
  name: string;
  order: number;
  collapsed: boolean;
  sortBy: BookmarkSortBy;
  sortDirection: BookmarkSortDirection;
  system?: boolean;
}

export interface BookmarkItem {
  id: string;
  type: BookmarkType;
  label: string;
  path: string;
  line?: number;
  groupId: string;
  description?: string;
  pinned?: boolean;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
  manualOrder: number;
}

export interface BookmarkFile {
  version: 2;
  groups: BookmarkGroup[];
  items: BookmarkItem[];
}
