import * as fs from "fs/promises";
import * as vscode from "vscode";
import { BookmarkItem } from "../types";
import { BookmarkStore } from "./store";

export async function openBookmark(store: BookmarkStore, bookmark: BookmarkItem): Promise<void> {
  const absolutePath = store.resolveAbsolutePath(bookmark.path);
  const exists = await pathExists(absolutePath);
  if (!exists) {
    throw new Error(`目标不存在: ${bookmark.path}`);
  }

  if (bookmark.type === "folder") {
    const uri = vscode.Uri.file(absolutePath);
    await vscode.commands.executeCommand("revealInExplorer", uri);
    return;
  }

  const document = await vscode.workspace.openTextDocument(absolutePath);
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  if (bookmark.type === "line") {
    const targetLine = Math.max(0, Math.min((bookmark.line ?? 1) - 1, document.lineCount - 1));
    const position = new vscode.Position(targetLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
