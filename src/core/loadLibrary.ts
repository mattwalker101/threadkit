import { loadProfiles, type LoadedProfile } from "./loadProfiles.js";
import { loadSkills, type LoadedSkill } from "./loadSkill.js";
import { resolveProfile } from "./resolveProfile.js";

export interface LoadedLibrary {
  root: string;
  skills: LoadedSkill[];
  profiles: LoadedProfile[];
}

export async function loadLibrary(root: string): Promise<LoadedLibrary> {
  const [skills, profiles] = await Promise.all([loadSkills(root), loadProfiles(root)]);

  for (const profile of profiles) {
    resolveProfile({ profile, skills });
  }

  return {
    root,
    skills,
    profiles
  };
}
