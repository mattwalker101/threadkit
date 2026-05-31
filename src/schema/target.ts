import { z } from "zod";
import { skillIdSchema } from "./skill.js";

export const rendererFormatSchema = z.enum([
  "markdown",
  "skill",
  "agents-md",
  "opencode-command",
  "gemini-toml"
]);

const targetPathsSchema = z
  .object({
    user: z.string().min(1).optional(),
    project: z.string().min(1).optional()
  })
  .strict()
  .refine((paths) => paths.user !== undefined || paths.project !== undefined, {
    message: "Target paths must define at least one scope."
  });

export const targetSchema = z
  .object({
    name: skillIdSchema,
    format: rendererFormatSchema,
    distSubdir: z.string().min(1),
    paths: targetPathsSchema
  })
  .strict();

export const targetMapSchema = z.record(skillIdSchema, targetSchema).superRefine((targetMap, context) => {
  for (const [key, target] of Object.entries(targetMap)) {
    if (key !== target.name) {
      context.addIssue({
        code: "custom",
        message: `Target map key '${key}' must match target name '${target.name}'.`,
        path: [key, "name"]
      });
    }
  }
});
