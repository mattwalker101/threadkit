import type { LoadedSkill } from "./loadSkill.js";

export type ExportScope = "user" | "project";

export interface RenderInput {
  profile: string;
  target: string;
  scope: ExportScope;
  skills: LoadedSkill[];
}

export interface FileSpec {
  relPath: string;
  content?: string;
  copySource?: string;
  marker: boolean;
}

export interface RenderResult {
  format: string;
  files: FileSpec[];
  warnings: string[];
}

export interface Renderer {
  render: (input: RenderInput) => RenderResult;
}

export interface WrittenFile {
  path: string;
  relPath: string;
  marker: boolean;
  bytes: number;
}
