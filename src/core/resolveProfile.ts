import type { LoadedProfile } from "./loadProfiles.js";
import type { LoadedSkill } from "./loadSkill.js";

export interface ResolvedProfile {
  profile: LoadedProfile;
  skills: LoadedSkill[];
}

export function resolveProfile(args: {
  profile: LoadedProfile;
  skills: LoadedSkill[];
}): ResolvedProfile {
  const skillsById = new Map(args.skills.map((skill) => [skill.id, skill]));
  const skills = args.profile.metadata.skills.map((skillId) => {
    const skill = skillsById.get(skillId);

    if (!skill) {
      throw new Error(`Profile '${args.profile.name}' references missing skill '${skillId}'.`);
    }

    return skill;
  });

  return {
    profile: args.profile,
    skills
  };
}
