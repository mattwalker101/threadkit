import { z } from "zod";

export const skillIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/);

export const profileNameSchema = skillIdSchema;

const targetFlagSchema = z
  .object({
    enabled: z.boolean()
  })
  .strict();

const safetySchema = z
  .object({
    allow_shell_commands: z.boolean(),
    allow_network: z.boolean(),
    allow_file_writes: z.boolean(),
    includes_scripts: z.boolean()
  })
  .strict();

const targetOverrideSchema = z
  .object({
    description: z.string().min(1).optional(),
    command_name: skillIdSchema.optional()
  })
  .strict();

export const skillStatusSchema = z.enum(["draft", "stable", "deprecated"]);
export const skillRiskSchema = z.enum(["low", "medium", "high"]);

export const skillSchema = z
  .object({
    id: skillIdSchema,
    name: z.string().min(1),
    version: z.string().min(1),
    status: skillStatusSchema,
    summary: z.string().min(1).max(1024),
    category: z.string().min(1),
    triggers: z.array(z.string().min(1)).min(2).max(10),
    profiles: z.array(profileNameSchema).min(1),
    targets: z
      .object({
        claude: targetFlagSchema.optional(),
        antigravity: targetFlagSchema.optional(),
        codex: targetFlagSchema.optional(),
        opencode: targetFlagSchema.optional(),
        gemini: targetFlagSchema.optional(),
        markdown: targetFlagSchema.optional()
      })
      .strict(),
    safety: safetySchema,
    tags: z.array(z.string().min(1)).default([]),
    description: z.string().min(1).optional(),
    risk: skillRiskSchema.optional(),
    owner: z.string().min(1).optional(),
    target_overrides: z
      .object({
        claude: targetOverrideSchema.optional(),
        antigravity: targetOverrideSchema.optional(),
        codex: targetOverrideSchema.optional(),
        opencode: targetOverrideSchema.optional(),
        gemini: targetOverrideSchema.optional(),
        markdown: targetOverrideSchema.optional()
      })
      .strict()
      .optional(),
    related: z.array(skillIdSchema).optional(),
    deprecated: z.boolean().optional(),
    replacement: skillIdSchema.nullable().optional()
  })
  .strict();
