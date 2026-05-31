#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("threadkit")
    .description("File-first portable skill library and exporter for AI coding CLIs.")
    .version("0.1.0");

  return program;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createProgram().parse();
}
