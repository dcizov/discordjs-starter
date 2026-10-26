/**
 * One place that turns a repository file path into a GitHub link.
 *
 * The docs site and `/help` both point at the file a page was generated from.
 * Hard-coding `blob/main` in each of them meant a deployed site linked to a
 * branch that may be far ahead of what is running, and it scattered the
 * repository URL across apps. The ref now comes from configuration:
 *
 * - `ORBIT_SOURCE_REF` — a commit id (preferred, unambiguous) or branch/tag name.
 *   Build it into the image (`docker build --build-arg ORBIT_SOURCE_REF=$GITHUB_SHA`)
 *   or export it before `npm run build`.
 * - Unset → `DEFAULT_SOURCE_REF` (`main`), so local development and a plain
 *   `next dev` keep working without configuration.
 *
 * Only build-time configuration and repository-relative paths reach this code:
 * the ref is never read from a request, and `sourceFileRef` rejects anything that
 * is not a plain repository path.
 */

export const SOURCE_REPOSITORY = "https://github.com/dcizov/discordjs-starter";

/** Used when nothing is configured, so a local build still links somewhere real. */
export const DEFAULT_SOURCE_REF = "main";

/**
 * Keep refs to characters git actually allows in names, then drop `refs/heads/`
 * so a CI-provided full ref still produces a working blob URL. Slashes are kept:
 * GitHub resolves a slash-containing branch against the file path when the
 * branch exists, but a commit id is the unambiguous choice for deployments.
 */
export function normalizeSourceRef(value: string | null | undefined): string {
  const trimmed = value?.trim().replace(/^refs\/heads\//, "");
  if (!trimmed) return DEFAULT_SOURCE_REF;
  if (
    trimmed.length > 200 ||
    /\.\./.test(trimmed) ||
    /[\s\\"'<>?#%]/.test(trimmed) ||
    !/^[A-Za-z0-9._/-]+$/.test(trimmed)
  )
    return DEFAULT_SOURCE_REF;
  return trimmed;
}

/** Repository-relative paths only; a leading `./`, `/` or a drive letter is refused. */
export function normalizeSourcePath(path: string): string | null {
  const trimmed = path.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (!trimmed || trimmed.length > 300) return null;
  if (/\.\./.test(trimmed) || /[\s\\"'<>?#%]/.test(trimmed)) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Absolute link to a file in the repository at the configured ref.
 * `ref` is injectable so builds and tests can be explicit instead of reading
 * the environment twice.
 */
export function sourceFileLink(
  file: string,
  options: { ref?: string | null; repository?: string } = {}
): string {
  const path = normalizeSourcePath(file);
  if (!path) throw new Error("Not a repository-relative file path.");
  const repo = (options.repository ?? SOURCE_REPOSITORY).replace(/\/+$/, "");
  const ref =
    options.ref === undefined
      ? normalizeSourceRef(process.env.ORBIT_SOURCE_REF)
      : normalizeSourceRef(options.ref);
  return `${repo}/blob/${ref}/${path}`;
}

/**
 * The ref a running build links to, for pages that want to name it. When it is
 * the fallback, callers should not claim the link points at the deployed commit.
 */
export function configuredSourceRef(): string {
  return normalizeSourceRef(process.env.ORBIT_SOURCE_REF);
}
