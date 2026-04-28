// Copyright 2026 Xinwei
// SPDX-License-Identifier: Apache-2.0

import { strict as assert } from "assert";
import { listMoveGroupTargets, sortSectionItems } from "../src/sidebar/view";
import { BookmarkGroup, BookmarkItem } from "../src/types";

function makeGroup(sortBy: BookmarkGroup["sortBy"]): BookmarkGroup {
  return {
    id: "group-1",
    name: "测试分组",
    order: 1,
    collapsed: false,
    sortBy,
    sortDirection: "asc"
  };
}

function makeItem(
  id: string,
  manualOrder: number,
  overrides: Partial<BookmarkItem & { missing: boolean; pinned?: boolean }> = {}
): BookmarkItem & { missing: boolean; pinned?: boolean } {
  return {
    id,
    label: id,
    path: id + ".ts",
    type: "file",
    groupId: "group-1",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    manualOrder,
    missing: false,
    pinned: false,
    ...overrides
  };
}

describe("sidebar sorting", () => {
  it("prioritizes pinned items in manual mode while keeping manualOrder within each tier", () => {
    const items = [
      makeItem("third", 2, { pinned: true }),
      makeItem("first", 0),
      makeItem("second", 1, { missing: true }),
      makeItem("pinned-first", 0, { pinned: true })
    ];

    const ordered = sortSectionItems(items, makeGroup("manual"));

    assert.deepEqual(
      ordered.map((item) => item.id),
      ["pinned-first", "third", "first", "second"]
    );
  });

  it("still prioritizes pinned and non-missing items for non-manual sorts", () => {
    const items = [
      makeItem("b", 1, { label: "b", pinned: true }),
      makeItem("a", 0, { label: "a" }),
      makeItem("c", 2, { label: "c", missing: true })
    ];

    const ordered = sortSectionItems(items, makeGroup("label"));

    assert.deepEqual(
      ordered.map((item) => item.id),
      ["b", "a", "c"]
    );
  });

  it("excludes the current group from move targets while preserving order", () => {
    const targets = listMoveGroupTargets(
      [
        { groupId: "ungrouped", title: "未分组" },
        { groupId: "group-a", title: "A组" },
        { groupId: "group-b", title: "B组" }
      ],
      "group-a"
    );

    assert.deepEqual(
      targets.map((item) => item.groupId),
      ["ungrouped", "group-b"]
    );
  });
});
