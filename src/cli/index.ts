#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { runList, runValidate, type CommandContext } from "./commands.js";

const defaultContext: CommandContext = {
  cwd: process.cwd(),
  write: (value) => process.stdout.write(value),
  writeError: (value) => process.stderr.write(value),
  setExitCode: (code) => {
    process.exitCode = code;
  }
};

export function createProgram(context: CommandContext = defaultContext): Command {
  const program = new Command();

  program
    .name("threadkit")
    .description("File-first portable skill library and exporter for AI coding CLIs.")
    .version("0.1.0");

  program
    .command("list")
    .description("List skills in a threadkit library.")
    .option("--root <path>", "Source library root.")
    .option("--format <format>", "Output format: text or json.")
    .action((options) => runList(options, context));

  program
    .command("validate")
    .description("Validate a threadkit library.")
    .option("--root <path>", "Source library root.")
    .option("--format <format>", "Output format: text or json.")
    .action((options) => runValidate(options, context));

  return program;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createProgram().parse();
}
