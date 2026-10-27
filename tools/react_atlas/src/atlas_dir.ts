import { closeSync, constants, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";

// Index and usage log are local; patterns/ and config.json are committed.
export const GITIGNORE = "/*\n!/.gitignore\n!/patterns/\n!/config.json\n";
export const atlasDir = (root: string) => path.join(root, ".react_atlas");

// A hostile repo could plant symlinks under .react_atlas/ to redirect our writes
// to files outside it, so directories are checked and files opened with O_NOFOLLOW.
const realDir = (dir: string) => {
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`refusing to write through symlink ${dir}`);
  mkdirSync(dir, { recursive: true });
};

/** Writes (or appends to) a file, refusing to follow a symlink at that path. */
export function writeNoFollow(file: string, data: string, append = false): void {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_APPEND, O_NOFOLLOW } = constants;
  const fd = openSync(file, O_WRONLY | O_CREAT | O_NOFOLLOW | (append ? O_APPEND : O_TRUNC), 0o644);
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

/** Creates `.react_atlas/` (and an optional subdirectory) with its .gitignore when missing. */
export function ensureDir(root: string, sub?: string): string {
  const dir = atlasDir(root);
  realDir(dir);
  const ignore = path.join(dir, ".gitignore");
  if (!lstatSync(ignore, { throwIfNoEntry: false })) writeNoFollow(ignore, GITIGNORE);
  if (!sub) return dir;
  realDir(path.join(dir, sub));
  return path.join(dir, sub);
}
