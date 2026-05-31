import type { z } from "zod";
import type { profileSchema } from "./profile.js";
import type { skillSchema } from "./skill.js";
import type { targetMapSchema, targetSchema } from "./target.js";

export type Skill = z.infer<typeof skillSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Target = z.infer<typeof targetSchema>;
export type TargetMap = z.infer<typeof targetMapSchema>;
