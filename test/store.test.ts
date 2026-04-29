// Copyright 2026 Xinwei
// SPDX-License-Identifier: Apache-2.0

import { strict as assert } from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { UNGROUPED_GROUP_ID } from "../src/bookmarks/schema";
import { BookmarkStore } from "../src/bookmarks/store";
import { sortSectionItems } from "../src/sidebar/helpers";

describe("BookmarkStore", () => {
  let workspaceRoot: string;
  let store: BookmarkStore;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jumpjump-"));
    store = new BookmarkStore(workspaceRoot);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("initializes config file automatically", async () => {
    const file = await store.ensureInitialized();
    assert.equal(file.items.length, 0);
    assert.equal(file.groups.length, 1);
    assert.equal(file.groups[0].id, UNGROUPED_GROUP_ID);
    const raw = await fs.readFile(store.configPath, "utf8");
    assert.match(raw, /"version": 2/);
  });

  it("adds bookmarks into the ungrouped section by default", async () => {
    const filePath = path.join(workspaceRoot, "app", "main.py");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "print('hi')\n", "utf8");

    const bookmark = await store.addBookmark({
      type: "file",
      label: "main.py",
      absolutePath: filePath
    });

    assert.equal(bookmark.path, "app/main.py");
    assert.equal(bookmark.groupId, UNGROUPED_GROUP_ID);
    const saved = await store.read();
    assert.equal(saved.groups[0].id, UNGROUPED_GROUP_ID);
  });

  it("preserves concurrent bookmark additions", async () => {
    const filePaths = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const filePath = path.join(workspaceRoot, `file-${index}.ts`);
        await fs.writeFile(filePath, `export const n = ${index};\n`, "utf8");
        return filePath;
      })
    );

    await Promise.all(
      filePaths.map((filePath, index) =>
        store.addBookmark({
          type: "file",
          label: `file-${index}.ts`,
          absolutePath: filePath
        })
      )
    );

    const saved = await store.read();
    assert.equal(saved.items.length, filePaths.length);
    assert.equal(new Set(saved.items.map((item) => item.label)).size, filePaths.length);
  });

  it("keeps workspace-root bookmarks valid and rejects paths outside the workspace", () => {
    assert.equal(store.toRelativePath(workspaceRoot), ".");
    assert.equal(path.resolve(store.resolveAbsolutePath(".")), path.resolve(workspaceRoot));
    assert.equal(store.isPathInsideWorkspace(workspaceRoot), true);
    assert.equal(store.isPathInsideWorkspace(path.join(workspaceRoot, "src", "index.ts")), true);
    assert.equal(store.isPathInsideWorkspace(path.join(path.dirname(workspaceRoot), "outside.ts")), false);
  });

  it("creates groups and moves bookmarks", async () => {
    const filePath = path.join(workspaceRoot, "router.go");
    await fs.writeFile(filePath, "package main\n", "utf8");
    const bookmark = await store.addBookmark({
      type: "file",
      label: "router.go",
      absolutePath: filePath
    });

    const group = await store.createGroup("核心入口");
    await store.moveBookmarkToGroup(bookmark.id, group.id);
    const saved = await store.read();
    assert.equal(saved.items[0].groupId, group.id);
  });

  it("renames and deletes bookmarks", async () => {
    const filePath = path.join(workspaceRoot, "router.go");
    await fs.writeFile(filePath, "package main\n", "utf8");
    const bookmark = await store.addBookmark({
      type: "file",
      label: "router.go",
      absolutePath: filePath
    });

    await store.renameBookmark(bookmark.id, "入口路由");
    let saved = await store.read();
    assert.equal(saved.items[0].label, "入口路由");

    const deleted = await store.deleteBookmark(bookmark.id);
    assert.equal(deleted, true);
    saved = await store.read();
    assert.equal(saved.items.length, 0);
  });

  it("toggles pinned and records recent open time", async () => {
    const filePath = path.join(workspaceRoot, "main.py");
    await fs.writeFile(filePath, "print('ok')\n", "utf8");
    const bookmark = await store.addBookmark({
      type: "file",
      label: "main.py",
      absolutePath: filePath
    });

    await store.togglePinned(bookmark.id);
    await store.markOpened(bookmark.id);

    const saved = await store.read();
    assert.equal(saved.items[0].pinned, true);
    assert.ok(saved.items[0].lastOpenedAt);
  });

  it("supports manual ordering inside a group", async () => {
    const firstPath = path.join(workspaceRoot, "a.py");
    const secondPath = path.join(workspaceRoot, "b.py");
    await fs.writeFile(firstPath, "print('a')\n", "utf8");
    await fs.writeFile(secondPath, "print('b')\n", "utf8");
    const group = await store.createGroup("调试热点");
    const first = await store.addBookmark({ type: "file", label: "a.py", absolutePath: firstPath, groupId: group.id });
    const second = await store.addBookmark({ type: "file", label: "b.py", absolutePath: secondPath, groupId: group.id });

    await store.moveBookmarkWithinGroup(second.id, "up");
    const saved = await store.read();
    const ordered = saved.items.filter((item) => item.groupId === group.id).sort((a, b) => a.manualOrder - b.manualOrder);
    assert.equal(ordered[0].id, second.id);
    assert.equal(ordered[1].id, first.id);
  });

  it("moves pinned bookmarks according to the visible manual order", async () => {
    const firstPath = path.join(workspaceRoot, "a.py");
    const secondPath = path.join(workspaceRoot, "b.py");
    const thirdPath = path.join(workspaceRoot, "c.py");
    await fs.writeFile(firstPath, "print('a')\n", "utf8");
    await fs.writeFile(secondPath, "print('b')\n", "utf8");
    await fs.writeFile(thirdPath, "print('c')\n", "utf8");
    const group = await store.createGroup("置顶排序");
    const first = await store.addBookmark({ type: "file", label: "a.py", absolutePath: firstPath, groupId: group.id });
    const second = await store.addBookmark({ type: "file", label: "b.py", absolutePath: secondPath, groupId: group.id });
    const third = await store.addBookmark({ type: "file", label: "c.py", absolutePath: thirdPath, groupId: group.id });
    await store.togglePinned(first.id);
    await store.togglePinned(third.id);

    const moved = await store.moveBookmarkWithinGroup(first.id, "down");

    const saved = await store.read();
    const savedGroup = saved.groups.find((entry) => entry.id === group.id);
    assert.equal(moved, true);
    assert.ok(savedGroup);
    const ordered = sortSectionItems(
      saved.items
        .filter((item) => item.groupId === group.id)
        .map((item) => ({ ...item, missing: false, pinned: item.pinned === true })),
      savedGroup
    );
    assert.deepEqual(
      ordered.map((item) => item.id),
      [third.id, first.id, second.id]
    );
  });

  it("reorders bookmarks inside a manual group from an explicit order", async () => {
    const firstPath = path.join(workspaceRoot, "a.py");
    const secondPath = path.join(workspaceRoot, "b.py");
    const thirdPath = path.join(workspaceRoot, "c.py");
    await fs.writeFile(firstPath, "print('a')\n", "utf8");
    await fs.writeFile(secondPath, "print('b')\n", "utf8");
    await fs.writeFile(thirdPath, "print('c')\n", "utf8");
    const group = await store.createGroup("手动排序");
    const first = await store.addBookmark({ type: "file", label: "a.py", absolutePath: firstPath, groupId: group.id });
    const second = await store.addBookmark({ type: "file", label: "b.py", absolutePath: secondPath, groupId: group.id });
    const third = await store.addBookmark({ type: "file", label: "c.py", absolutePath: thirdPath, groupId: group.id });

    await store.reorderBookmarksInGroup(group.id, [third.id, first.id, second.id]);

    const saved = await store.read();
    const ordered = saved.items.filter((item) => item.groupId === group.id).sort((a, b) => a.manualOrder - b.manualOrder);
    assert.deepEqual(
      ordered.map((item) => item.id),
      [third.id, first.id, second.id]
    );
  });

  it("switches a group to manual sort when bookmarks are drag-reordered", async () => {
    const firstPath = path.join(workspaceRoot, "a.py");
    const secondPath = path.join(workspaceRoot, "b.py");
    await fs.writeFile(firstPath, "print('a')\n", "utf8");
    await fs.writeFile(secondPath, "print('b')\n", "utf8");
    const group = await store.createGroup("名称排序");
    const first = await store.addBookmark({ type: "file", label: "a.py", absolutePath: firstPath, groupId: group.id });
    const second = await store.addBookmark({ type: "file", label: "b.py", absolutePath: secondPath, groupId: group.id });
    await store.setGroupSort(group.id, "label", "asc");

    await store.reorderBookmarksInGroup(group.id, [second.id, first.id]);

    const saved = await store.read();
    const savedGroup = saved.groups.find((entry) => entry.id === group.id);
    const ordered = saved.items.filter((item) => item.groupId === group.id).sort((a, b) => a.manualOrder - b.manualOrder);
    assert.equal(savedGroup?.sortBy, "manual");
    assert.equal(savedGroup?.sortDirection, "asc");
    assert.deepEqual(
      ordered.map((item) => item.id),
      [second.id, first.id]
    );
  });

  it("moves a bookmark to another group using a dragged order", async () => {
    const firstPath = path.join(workspaceRoot, "a.py");
    const secondPath = path.join(workspaceRoot, "b.py");
    const thirdPath = path.join(workspaceRoot, "c.py");
    await fs.writeFile(firstPath, "print('a')\n", "utf8");
    await fs.writeFile(secondPath, "print('b')\n", "utf8");
    await fs.writeFile(thirdPath, "print('c')\n", "utf8");
    const sourceGroup = await store.createGroup("来源");
    const targetGroup = await store.createGroup("目标");
    const moved = await store.addBookmark({ type: "file", label: "a.py", absolutePath: firstPath, groupId: sourceGroup.id });
    const targetFirst = await store.addBookmark({ type: "file", label: "b.py", absolutePath: secondPath, groupId: targetGroup.id });
    const targetSecond = await store.addBookmark({ type: "file", label: "c.py", absolutePath: thirdPath, groupId: targetGroup.id });
    await store.setGroupSort(targetGroup.id, "label", "asc");

    await store.moveBookmarkToGroupAndReorder(moved.id, targetGroup.id, [targetFirst.id, moved.id, targetSecond.id]);

    const saved = await store.read();
    const savedTargetGroup = saved.groups.find((entry) => entry.id === targetGroup.id);
    const ordered = saved.items.filter((item) => item.groupId === targetGroup.id).sort((a, b) => a.manualOrder - b.manualOrder);
    assert.equal(saved.items.find((item) => item.id === moved.id)?.groupId, targetGroup.id);
    assert.equal(savedTargetGroup?.sortBy, "manual");
    assert.deepEqual(
      ordered.map((item) => item.id),
      [targetFirst.id, moved.id, targetSecond.id]
    );
  });

  it("reorders groups and falls back to ungrouped on delete", async () => {
    const filePath = path.join(workspaceRoot, "service.py");
    await fs.writeFile(filePath, "pass\n", "utf8");
    const firstGroup = await store.createGroup("A组");
    const secondGroup = await store.createGroup("B组");
    const bookmark = await store.addBookmark({ type: "file", label: "service.py", absolutePath: filePath, groupId: secondGroup.id });

    await store.reorderGroups([secondGroup.id, firstGroup.id]);
    await store.deleteGroup(secondGroup.id);

    const saved = await store.read();
    assert.equal(saved.groups[1].id, firstGroup.id);
    assert.equal(saved.items.find((item) => item.id === bookmark.id)?.groupId, UNGROUPED_GROUP_ID);
  });

  it("updates sort mode for the ungrouped section", async () => {
    await store.ensureInitialized();
    await store.setGroupSort(UNGROUPED_GROUP_ID, "label", "asc");
    const saved = await store.read();
    assert.equal(saved.groups[0].sortBy, "label");
    assert.equal(saved.groups[0].sortDirection, "asc");
  });

  it("rejects invalid config json", async () => {
    await fs.mkdir(path.dirname(store.configPath), { recursive: true });
    await fs.writeFile(store.configPath, "{not-json}", "utf8");
    await assert.rejects(() => store.read(), /JSON 解析失败/);
  });

  it("removes missing bookmarks", async () => {
    const realFile = path.join(workspaceRoot, "service.py");
    await fs.writeFile(realFile, "pass\n", "utf8");

    await store.addBookmark({
      type: "file",
      label: "service.py",
      absolutePath: realFile
    });
    await store.addBookmark({
      type: "file",
      label: "gone.py",
      absolutePath: path.join(workspaceRoot, "gone.py")
    });

    const removed = await store.removeMissingBookmarks();
    assert.equal(removed, 1);
    const saved = await store.read();
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].label, "service.py");
  });
});
