import { markdownRenderer } from "./renderMarkdown.js";
import { skillRenderer } from "./renderSkill.js";
import type { Renderer } from "./renderTypes.js";

export const renderers = {
  markdown: markdownRenderer,
  skill: skillRenderer
} as const satisfies Record<string, Renderer>;

export type RendererFormat = keyof typeof renderers;

export function getRenderer(format: string): Renderer | undefined {
  return renderers[format as RendererFormat];
}
