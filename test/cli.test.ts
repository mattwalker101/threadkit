import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/index.js";

function makeHarness() {
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;

  const program = createProgram({
    cwd: process.cwd(),
    write: (value) => {
      stdout += value;
    },
    writeError: (value) => {
      stderr += value;
    },
    setExitCode: (code) => {
      exitCode = code;
    }
  });

  program.exitOverride();
  program.configureOutput({
    writeOut: (value) => {
      stdout += value;
    },
    writeErr: (value) => {
      stderr += value;
    }
  });

  return {
    program,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get exitCode() {
      return exitCode;
    }
  };
}

describe("threadkit CLI", () => {
  it("exposes the program name and version", () => {
    const { program } = makeHarness();

    expect(program.name()).toBe("threadkit");
    expect(program.version()).toBe("0.1.0");
  });

  it("validates the repository library as JSON", async () => {
    const harness = makeHarness();

    await harness.program.parseAsync(["node", "threadkit", "validate", "--format", "json"]);

    expect(harness.stderr).toBe("");
    expect(harness.exitCode).toBe(0);
    expect(JSON.parse(harness.stdout)).toMatchObject({
      ok: true,
      root: process.cwd(),
      errors: [],
      warnings: []
    });
  });
});
