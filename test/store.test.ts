import { strict as assert } from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { UNGROUPED_GROUP_ID } from "../src/bookmarks/schema";
import { BookmarkStore } from "../src/bookmarks/store";

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
