// Folder-tree → repo-path mapping. Folders are identified by ID (n8n allows
// duplicate names), so each path segment carries the id: "Name - (id)".

/** A single path segment. '/' in a folder name is flattened to '-' (it's a dir). */
export function folderSegment(name: string, id: string): string {
  return `${name.replace(/\//g, '-')} - (${id})`;
}

/** Build "Root - (id)/Child - (id)/…" for a folder id, walking parents.
 *  Stops at an unknown id and guards against a parentFolderId cycle. */
export function buildFolderPath(
  id: string | null,
  names: ReadonlyMap<string, string>,
  parents: ReadonlyMap<string, string | null>,
): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur && names.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    parts.unshift(folderSegment(names.get(cur)!, cur));
    cur = parents.get(cur) ?? null;
  }
  return parts.join('/');
}
