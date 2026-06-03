import { describe, expect, it } from "vitest";
import { MANAGED_MARKER_REGEX, MANAGED_MARKER_TOKEN, hasManagedMarker } from "../src/core/marker.js";

describe("MANAGED_MARKER_REGEX", () => {
  it("matches the bare token", () => {
    expect(MANAGED_MARKER_REGEX.test("threadkit:generated")).toBe(true);
  });

  it("matches token inside an HTML comment", () => {
    expect(MANAGED_MARKER_REGEX.test("<!-- threadkit:generated target=skill profile=default -->")).toBe(true);
  });

  it("does not match when token is a substring without word boundary", () => {
    expect(MANAGED_MARKER_REGEX.test("xthreadkit:generated")).toBe(false);
  });
});

describe("hasManagedMarker", () => {
  function buf(text: string): Buffer {
    return Buffer.from(text, "utf8");
  }

  it("returns true when marker is on line 1", () => {
    expect(hasManagedMarker(buf("<!-- threadkit:generated target=skill -->\nsome content\n"))).toBe(true);
  });

  it("returns true when marker is on line 15", () => {
    const lines = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`);
    lines.push("<!-- threadkit:generated -->");
    expect(hasManagedMarker(buf(lines.join("\n")))).toBe(true);
  });

  it("returns false when marker appears only on line 16", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
    lines.push("<!-- threadkit:generated -->");
    expect(hasManagedMarker(buf(lines.join("\n")))).toBe(false);
  });

  it("returns false when marker is absent", () => {
    expect(hasManagedMarker(buf("# Some skill\n\nNo marker here.\n"))).toBe(false);
  });

  it("returns false for empty content", () => {
    expect(hasManagedMarker(buf(""))).toBe(false);
  });

  it("handles Windows line endings", () => {
    expect(hasManagedMarker(buf("<!-- threadkit:generated -->\r\ncontent\r\n"))).toBe(true);
  });
});
