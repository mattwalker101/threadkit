export const MANAGED_MARKER_TOKEN = "threadkit:generated";
export const MANAGED_MARKER_REGEX = new RegExp(`\\b${MANAGED_MARKER_TOKEN}\\b`);

export function hasManagedMarker(content: Buffer): boolean {
  let pos = -1;
  for (let i = 0; i < 15; i++) {
    const next = content.indexOf(10, pos + 1);
    if (next === -1) { pos = content.length; break; }
    pos = next;
  }
  return MANAGED_MARKER_REGEX.test(content.subarray(0, pos).toString("utf8"));
}
