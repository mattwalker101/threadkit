import { z } from "zod";
import { profileNameSchema, skillIdSchema } from "./skill.js";

export const profileSchema = z
  .object({
    name: profileNameSchema,
    description: z.string().min(1),
    skills: z.array(skillIdSchema).min(1)
  })
  .strict()
  .superRefine((profile, context) => {
    const seen = new Set<string>();

    for (const [index, skillId] of profile.skills.entries()) {
      if (seen.has(skillId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate skill '${skillId}' in profile.`,
          path: ["skills", index]
        });
      }

      seen.add(skillId);
    }
  });
