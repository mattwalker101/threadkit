import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/index.js";

describe("threadkit CLI scaffold", () => {
  it("exposes the program name and version", () => {
    const program = createProgram();

    expect(program.name()).toBe("threadkit");
    expect(program.version()).toBe("0.1.0");
  });
});
