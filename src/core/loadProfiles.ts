import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { profileSchema, type Profile } from "../schema/index.js";

export interface LoadedProfile {
  name: string;
  file: string;
  metadata: Profile;
}

export async function loadProfile(args: { root: string; name: string }): Promise<LoadedProfile> {
  const file = join(args.root, "profiles", `${args.name}.yml`);
  const metadata = profileSchema.parse(parse(await readFile(file, "utf8")));

  if (metadata.name !== args.name) {
    throw new Error(`Profile file '${args.name}.yml' does not match profile name '${metadata.name}'.`);
  }

  return {
    name: metadata.name,
    file,
    metadata
  };
}

export async function loadProfiles(root: string): Promise<LoadedProfile[]> {
  const entries = await readdir(join(root, "profiles"), { withFileTypes: true });
  const profileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => basename(entry.name, ".yml"))
    .sort();

  return Promise.all(profileNames.map((name) => loadProfile({ root, name })));
}
