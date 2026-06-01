import { markdownRenderer } from "./renderMarkdown.js";
import { agentsMdRenderer } from "./renderAgentsMd.js";
import { geminiTomlRenderer } from "./renderGeminiToml.js";
import { openCodeCommandRenderer } from "./renderOpenCodeCommand.js";
import { skillRenderer } from "./renderSkill.js";
import type { Renderer } from "./renderTypes.js";

export const renderers = {
  markdown: markdownRenderer,
  "agents-md": agentsMdRenderer,
  "gemini-toml": geminiTomlRenderer,
  "opencode-command": openCodeCommandRenderer,
  skill: skillRenderer
} as const satisfies Record<string, Renderer>;

export type RendererFormat = keyof typeof renderers;

export function getRenderer(format: string): Renderer | undefined {
  return renderers[format as RendererFormat];
}
