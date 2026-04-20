import { strict as assert } from "assert";
import {
  BOOKMARKS_VERSION,
  UNGROUPED_GROUP_ID,
  createEmptyBookmarkFile,
  normalizeRelativePath,
  sanitizeLine,
  validateBookmarkFile
} from "../src/bookmarks/schema";

describe("schema helpers", () => {
  it("creates an empty bookmark file", () => {
    const file = createEmptyBookmarkFile();
    assert.equal(file.version, BOOKMARKS_VERSION);
    assert.equal(file.groups.length, 1);
    assert.equal(file.groups[0].id, UNGROUPED_GROUP_ID);
    assert.equal(file.items.length, 0);
  });

  it("normalizes path separators", () => {
    assert.equal(normalizeRelativePath("src\\main.py"), "src/main.py");
  });

  it("sanitizes invalid line numbers", () => {
    assert.equal(sanitizeLine(0), undefined);
    assert.equal(sanitizeLine(4.8), 4);
  });

  it("validates v2 bookmark file shape", () => {
    const result = validateBookmarkFile({
      version: 2,
      groups: [
        {
          id: "ungrouped",
          name: "未分组",
          order: 0,
          collapsed: false,
          sortBy: "createdAt",
          sortDirection: "desc",
          system: true
        }
      ],
      items: [
        {
          id: "1",
          type: "line",
          label: "router.go:42",
          path: "internal/router.go",
          line: 42,
          groupId: "ungrouped",
          pinned: true,
          createdAt: "2026-03-30T10:00:00.000Z",
          updatedAt: "2026-03-30T10:00:00.000Z",
          manualOrder: 0
        }
      ]
    });
    assert.equal(result.items[0].line, 42);
    assert.equal(result.items[0].pinned, true);
  });

  it("migrates legacy v1 bookmark file", () => {
    const result = validateBookmarkFile({
      version: 1,
      groups: ["核心入口"],
      items: [
        {
          id: "1",
          type: "file",
          label: "main.py",
          path: "app/main.py",
          group: "核心入口"
        }
      ]
    });
    assert.equal(result.version, 2);
    assert.equal(result.groups[0].id, UNGROUPED_GROUP_ID);
    assert.equal(result.groups.length, 2);
    assert.equal(result.items[0].groupId, result.groups[1].id);
  });

  it("rejects invalid json data", () => {
    assert.throws(() =>
      validateBookmarkFile({
        version: 2,
        groups: [],
        items: [{ id: "1", type: "line", label: "bad", path: "x" }]
      })
    );
  });
});
