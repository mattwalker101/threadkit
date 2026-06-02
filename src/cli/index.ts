#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import {
  runAudit,
  runBackupList,
  runBackupPrune,
  runExport,
  runInstall,
  runList,
  runRollback,
  runShow,
  runUninstall,
  runValidate,
  type CommandContext
} from "./commands.js";

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
    .command("show")
    .description("Show a skill from a threadkit library.")
    .argument("<skill-id>", "Skill id.")
    .option("--root <path>", "Source library root.")
    .option("--format <format>", "Output format: text or json.")
    .action((skillId, options) => runShow(skillId, options, context));

  program
    .command("validate")
    .description("Validate a threadkit library.")
    .option("--root <path>", "Source library root.")
    .option("--format <format>", "Output format: text or json.")
    .action((options) => runValidate(options, context));

  program
    .command("audit")
    .description("Audit a threadkit library for quality warnings.")
    .option("--root <path>", "Source library root.")
    .option("--format <format>", "Output format: text or json.")
    .option("--strict", "Exit 1 when audit warnings are present.")
    .action((options) => runAudit(options, context));

  program
    .command("export")
    .description("Export a threadkit profile for a target.")
    .argument("<target>", "Export target.")
    .option("--profile <name>", "Profile name.")
    .option("--root <path>", "Source library root.")
    .option("--out <path>", "Output root.")
    .option("--format <format>", "Output format: text or json.")
    .action((target, options) => runExport(target, options, context));

  program
    .command("install")
    .description("Plan installation of a threadkit profile for a target.")
    .argument("<target>", "Install target.")
    .option("--profile <name>", "Profile name.")
    .option("--root <path>", "Source library root.")
    .option("--scope <scope>", "Install scope: user or project.")
    .option("--format <format>", "Output format: text or json.")
    .option("--apply", "Apply the install plan.")
    .option("--force", "Overwrite foreign files.")
    .action((target, options) => runInstall(target, options, context));

  program
    .command("uninstall")
    .description("Plan removal of files from the latest threadkit install manifest.")
    .argument("<target>", "Uninstall target.")
    .option("--scope <scope>", "Install scope: user or project.")
    .option("--format <format>", "Output format: text or json.")
    .option("--apply", "Apply the uninstall plan.")
    .option("--prune-empty-dirs", "Remove empty directories left after uninstalling managed files.")
    .action((target, options) => runUninstall(target, options, context));

  program
    .command("rollback")
    .description("Restore backed-up files from the latest threadkit install manifest.")
    .argument("<target>", "Rollback target.")
    .option("--scope <scope>", "Install scope: user or project.")
    .option("--format <format>", "Output format: text or json.")
    .option("--apply", "Apply the rollback plan.")
    .option("--force", "Restore over drifted ThreadKit-managed files.")
    .option("--generation <id>", "Rollback from a named backup generation.")
    .action((target, options) => runRollback(target, options, context));

  const backups = program.command("backups").description("Inspect and prune threadkit backup generations.");

  backups
    .command("list")
    .description("List indexed backup generations for a target.")
    .argument("<target>", "Install target.")
    .option("--scope <scope>", "Install scope: user or project.")
    .option("--format <format>", "Output format: text or json.")
    .action((target, options) => runBackupList(target, options, context));

  backups
    .command("prune")
    .description("Prune indexed backup generations for a target.")
    .argument("<target>", "Install target.")
    .option("--scope <scope>", "Install scope: user or project.")
    .option("--keep <count>", "Number of newest generations to keep.", "10")
    .option("--apply", "Apply the prune plan.")
    .option("--format <format>", "Output format: text or json.")
    .action((target, options) => runBackupPrune(target, options, context));

  return program;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createProgram().parse();
}
