import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentForSpec, isInsideDirectory, resolveSafePathInside } from "../src/core/resolveSafePath.js";

const base = join(tmpdir(), "threadkit-test-base");

describe("resolveSafePathInside", () => {
  it("resolves a normal relative path inside base", () => {
    const result = resolveSafePathInside(base, "foo/bar.txt");
    expect(result).toBe(join(base, "foo", "bar.txt"));
  });

  it("resolves a path exactly equal to base", () => {
    const result = resolveSafePathInside(base, ".");
    expect(result).toBe(base);
  });

  it("throws when path traverses above base", () => {
    expect(() => resolveSafePathInside(base, "../escape.txt")).toThrow(
      "Path '../escape.txt' escapes the base directory."
    );
  });

  it("throws with custom label", () => {
    expect(() => resolveSafePathInside(base, "../../etc/passwd", "Install file path")).toThrow(
      "Install file path '../../etc/passwd' escapes the base directory."
    );
  });

  it("throws on absolute path outside base", () => {
    expect(() => resolveSafePathInside(base, "/etc/passwd")).toThrow("escapes the base directory.");
  });
});

describe("isInsideDirectory", () => {
  it("returns true for path inside base", () => {
    expect(isInsideDirectory(base, join(base, "sub", "file.txt"))).toBe(true);
  });

  it("returns false for path equal to base", () => {
    expect(isInsideDirectory(base, base)).toBe(false);
  });

  it("returns false for path outside base", () => {
    expect(isInsideDirectory(base, join(tmpdir(), "other"))).toBe(false);
  });

  it("returns false for path that is a prefix match but not a real child", () => {
    const tightBase = join(tmpdir(), "foo");
    const sibling = join(tmpdir(), "foobar", "file.txt");
    expect(isInsideDirectory(tightBase, sibling)).toBe(false);
  });
});

describe("contentForSpec", () => {
  it("returns inline content when provided", async () => {
    const result = await contentForSpec({ relPath: "f.txt", content: "hello", marker: false });
    expect(result).toBe("hello");
  });

  it("throws when neither content nor copySource is set", async () => {
    await expect(contentForSpec({ relPath: "f.txt", marker: false })).rejects.toThrow(
      "File 'f.txt' must define content or copySource."
    );
  });
});
