import { loadProfiles, type LoadedProfile } from "./loadProfiles.js";
import { loadSkills, type LoadedSkill } from "./loadSkill.js";
import { resolveProfile } from "./resolveProfile.js";

export interface LoadedLibrary {
  root: string;
  skills: LoadedSkill[];
  profiles: LoadedProfile[];
}

export interface LoadLibraryOptions {
  canonical?: boolean;
}

const canonicalSkillIds = [
  "implementation-plan",
  "build-handoff",
  "code-review",
  "debugging-loop",
  "skill-capture",
  "handoff"
];

const canonicalTargetFlags = ["claude", "antigravity", "codex", "opencode", "gemini", "markdown"];

export async function loadLibrary(root: string, options: LoadLibraryOptions = {}): Promise<LoadedLibrary> {
  const [skills, profiles] = await Promise.all([loadSkills(root), loadProfiles(root)]);

  for (const profile of profiles) {
    resolveProfile({ profile, skills });
  }

  validateProfileReverseIndex({ skills, profiles });

  if (options.canonical === true) {
    validateCanonicalLibrary({ skills });
  }

  return {
    root,
    skills,
    profiles
  };
}

function validateProfileReverseIndex(args: {
  skills: LoadedSkill[];
  profiles: LoadedProfile[];
}): void {
  const profilesByName = new Map(args.profiles.map((profile) => [profile.name, profile]));
  const skillsById = new Map(args.skills.map((skill) => [skill.id, skill]));

  for (const skill of args.skills) {
    for (const profileName of skill.metadata.profiles) {
      const profile = profilesByName.get(profileName);

      if (!profile) {
        throw new Error(`Skill '${skill.id}' metadata references missing profile '${profileName}'.`);
      }

      if (!profile.metadata.skills.includes(skill.id)) {
        throw new Error(
          `Skill '${skill.id}' metadata lists profile '${profile.name}', but profile '${profile.name}' does not list skill '${skill.id}'.`
        );
      }
    }
  }

  for (const profile of args.profiles) {
    for (const skillId of profile.metadata.skills) {
      const skill = skillsById.get(skillId);

      if (!skill) {
        continue;
      }

      if (!skill.metadata.profiles.includes(profile.name)) {
        throw new Error(
          `Profile '${profile.name}' lists skill '${skill.id}', but skill metadata does not list profile '${profile.name}'.`
        );
      }
    }
  }
}

function validateCanonicalLibrary(args: { skills: LoadedSkill[] }): void {
  const actualSkillIds = args.skills.map((skill) => skill.id).sort();
  const expectedSkillIds = [...canonicalSkillIds].sort();
  const unexpectedSkillIds = actualSkillIds.filter((id) => !expectedSkillIds.includes(id));
  const missingSkillIds = expectedSkillIds.filter((id) => !actualSkillIds.includes(id));

  if (unexpectedSkillIds.length > 0) {
    throw new Error(`Canonical library contains unexpected skill directories: ${unexpectedSkillIds.join(", ")}.`);
  }

  if (missingSkillIds.length > 0) {
    throw new Error(`Canonical library is missing skill directories: ${missingSkillIds.join(", ")}.`);
  }

  for (const skill of args.skills) {
    const missingTargetFlags = canonicalTargetFlags.filter((target) => !(target in skill.metadata.targets));

    if (missingTargetFlags.length > 0) {
      throw new Error(
        `Canonical skill '${skill.id}' is missing target flags: ${missingTargetFlags.join(", ")}.`
      );
    }
  }
}
