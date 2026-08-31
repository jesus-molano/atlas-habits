const GITHUB_OWNER = 'jesus-molano';
const GITHUB_REPOSITORY = 'atlas-habits';
const RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/latest`;
const APK_ASSET_NAME = 'atlas.apk';
const CHECKSUM_ASSET_NAME = 'atlas.apk.sha256';
const MAX_CHECKSUM_LENGTH = 4096;
const DEFAULT_TIMEOUT_MS = 15_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface GithubAssetPayload {
  readonly browser_download_url: string;
  readonly name: string;
  readonly size: number;
}

interface GithubReleasePayload {
  readonly assets: readonly GithubAssetPayload[];
  readonly body: string | null;
  readonly draft: boolean;
  readonly html_url: string;
  readonly id: number;
  readonly name: string | null;
  readonly prerelease: boolean;
  readonly published_at: string | null;
  readonly tag_name: string;
}

export interface AtlasGithubRelease {
  readonly apkSize: number;
  readonly apkUrl: string;
  readonly checksumUrl: string;
  readonly notes: string | null;
  readonly prerelease: boolean;
  readonly publishedAt: string | null;
  readonly releaseId: number;
  readonly releasePageUrl: string;
  readonly sha256: string;
  readonly tagName: string;
  readonly title: string;
  readonly version: string;
}

export interface FetchLatestAtlasReleaseOptions {
  readonly fetchImpl?: FetchLike;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export class AtlasReleaseError extends Error {
  constructor(
    readonly code:
      | 'github_unavailable'
      | 'invalid_release'
      | 'missing_asset'
      | 'invalid_checksum',
    message: string,
  ) {
    super(message);
    this.name = 'AtlasReleaseError';
  }
}

export async function fetchLatestAtlasRelease(
  options: FetchLatestAtlasReleaseOptions = {},
): Promise<AtlasGithubRelease> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const releaseResponse = await fetchWithTimeout(
    RELEASE_API_URL,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: options.signal,
    },
    fetchImpl,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!releaseResponse.ok) {
    throw new AtlasReleaseError(
      'github_unavailable',
      `GitHub Releases respondió con HTTP ${releaseResponse.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await releaseResponse.json();
  } catch {
    throw new AtlasReleaseError(
      'invalid_release',
      'GitHub devolvió una respuesta que no contiene JSON válido.',
    );
  }
  const release = parseReleasePayload(payload);
  const apkAssets = release.assets.filter(
    (asset) => asset.name === APK_ASSET_NAME,
  );
  const checksumAssets = release.assets.filter(
    (asset) => asset.name === CHECKSUM_ASSET_NAME,
  );
  if (apkAssets.length !== 1 || checksumAssets.length !== 1) {
    throw new AtlasReleaseError(
      'missing_asset',
      `La release debe incluir exactamente un ${APK_ASSET_NAME} y un ${CHECKSUM_ASSET_NAME}.`,
    );
  }
  const [apkAsset] = apkAssets;
  const [checksumAsset] = checksumAssets;

  assertGithubReleaseAssetUrl(apkAsset.browser_download_url);
  assertGithubReleaseAssetUrl(checksumAsset.browser_download_url);

  const checksumResponse = await fetchWithTimeout(
    checksumAsset.browser_download_url,
    {
      headers: { Accept: 'text/plain' },
      signal: options.signal,
    },
    fetchImpl,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!checksumResponse.ok) {
    throw new AtlasReleaseError(
      'github_unavailable',
      `GitHub Releases respondió con HTTP ${checksumResponse.status} para el checksum.`,
    );
  }
  const declaredChecksumLength = Number(
    checksumResponse.headers.get('content-length'),
  );
  if (
    Number.isFinite(declaredChecksumLength) &&
    declaredChecksumLength > MAX_CHECKSUM_LENGTH
  ) {
    throw new AtlasReleaseError(
      'invalid_checksum',
      'El fichero SHA-256 es demasiado grande.',
    );
  }
  const checksumFile = await checksumResponse.text();
  if (checksumFile.length > MAX_CHECKSUM_LENGTH) {
    throw new AtlasReleaseError(
      'invalid_checksum',
      'El fichero SHA-256 es demasiado grande.',
    );
  }

  const version = versionFromReleaseTag(release.tag_name);
  return {
    apkSize: apkAsset.size,
    apkUrl: apkAsset.browser_download_url,
    checksumUrl: checksumAsset.browser_download_url,
    notes: release.body,
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    releaseId: release.id,
    releasePageUrl: release.html_url,
    sha256: parseSha256File(checksumFile),
    tagName: release.tag_name,
    title: release.name?.trim() || `Atlas ${version}`,
    version,
  };
}

export function parseSha256File(contents: string): string {
  const matchingHashes = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => /^([0-9a-f]{64})\s+\*?atlas\.apk$/iu.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1].toLowerCase());

  if (matchingHashes.length !== 1) {
    throw new AtlasReleaseError(
      'invalid_checksum',
      'El fichero SHA-256 no contiene una única suma válida para atlas.apk.',
    );
  }
  return matchingHashes[0];
}

export function versionFromReleaseTag(tagName: string): string {
  if (
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(tagName)
  ) {
    throw new AtlasReleaseError(
      'invalid_release',
      `La etiqueta de la release no es una versión de Atlas válida: ${tagName}.`,
    );
  }
  return tagName.slice(1);
}

export function compareAtlasVersions(left: string, right: string): number {
  const leftVersion = parseComparableVersion(left);
  const rightVersion = parseComparableVersion(right);

  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.core[index] - rightVersion.core[index];
    if (difference !== 0) return Math.sign(difference);
  }

  if (leftVersion.prerelease === null && rightVersion.prerelease !== null)
    return 1;
  if (leftVersion.prerelease !== null && rightVersion.prerelease === null)
    return -1;
  if (leftVersion.prerelease === null || rightVersion.prerelease === null)
    return 0;

  const componentCount = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < componentCount; index += 1) {
    const leftComponent = leftVersion.prerelease[index];
    const rightComponent = rightVersion.prerelease[index];
    if (leftComponent === undefined) return -1;
    if (rightComponent === undefined) return 1;
    if (leftComponent === rightComponent) continue;

    const leftNumber = /^\d+$/u.test(leftComponent)
      ? Number(leftComponent)
      : null;
    const rightNumber = /^\d+$/u.test(rightComponent)
      ? Number(rightComponent)
      : null;
    if (leftNumber !== null && rightNumber !== null)
      return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return Math.sign(leftComponent.localeCompare(rightComponent, 'en'));
  }
  return 0;
}

function parseReleasePayload(payload: unknown): GithubReleasePayload {
  if (!isRecord(payload) || !Array.isArray(payload.assets)) {
    throw new AtlasReleaseError(
      'invalid_release',
      'GitHub devolvió una release no válida.',
    );
  }

  const assets = payload.assets.map((asset) => {
    if (
      !isRecord(asset) ||
      typeof asset.name !== 'string' ||
      typeof asset.browser_download_url !== 'string' ||
      typeof asset.size !== 'number' ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0
    ) {
      throw new AtlasReleaseError(
        'invalid_release',
        'GitHub devolvió un recurso no válido.',
      );
    }
    return {
      browser_download_url: asset.browser_download_url,
      name: asset.name,
      size: asset.size,
    };
  });

  if (
    typeof payload.id !== 'number' ||
    !Number.isSafeInteger(payload.id) ||
    typeof payload.tag_name !== 'string' ||
    typeof payload.html_url !== 'string' ||
    typeof payload.draft !== 'boolean' ||
    typeof payload.prerelease !== 'boolean' ||
    (payload.name !== null && typeof payload.name !== 'string') ||
    (payload.body !== null && typeof payload.body !== 'string') ||
    (payload.published_at !== null && typeof payload.published_at !== 'string')
  ) {
    throw new AtlasReleaseError(
      'invalid_release',
      'GitHub devolvió metadatos no válidos.',
    );
  }
  if (payload.draft) {
    throw new AtlasReleaseError(
      'invalid_release',
      'La release más reciente todavía es un borrador.',
    );
  }

  assertGithubReleasePageUrl(payload.html_url);
  return {
    assets,
    body: payload.body,
    draft: payload.draft,
    html_url: payload.html_url,
    id: payload.id,
    name: payload.name,
    prerelease: payload.prerelease,
    published_at: payload.published_at,
    tag_name: payload.tag_name,
  };
}

function parseComparableVersion(version: string): {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[] | null;
} {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      version,
    );
  if (!match) {
    throw new AtlasReleaseError(
      'invalid_release',
      `Versión no válida: ${version}.`,
    );
  }
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!core.every(Number.isSafeInteger)) {
    throw new AtlasReleaseError(
      'invalid_release',
      `Versión fuera de rango: ${version}.`,
    );
  }
  return { core, prerelease: match[4]?.split('.') ?? null };
}

function assertGithubReleaseAssetUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AtlasReleaseError(
      'invalid_release',
      'GitHub devolvió una URL de descarga no válida.',
    );
  }
  const expectedPrefix = `/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/download/`;
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith(expectedPrefix)
  ) {
    throw new AtlasReleaseError(
      'invalid_release',
      'La descarga no pertenece a las releases oficiales de Atlas.',
    );
  }
}

function assertGithubReleasePageUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AtlasReleaseError(
      'invalid_release',
      'GitHub devolvió una URL de release no válida.',
    );
  }
  const expectedPrefix = `/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/`;
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !url.pathname.startsWith(expectedPrefix)
  ) {
    throw new AtlasReleaseError(
      'invalid_release',
      'La release no pertenece al repositorio de Atlas.',
    );
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternalSignal = () =>
    controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternalSignal();
  else
    externalSignal?.addEventListener('abort', abortFromExternalSignal, {
      once: true,
    });

  const timeout = setTimeout(
    () => controller.abort(new Error('GitHub request timeout')),
    timeoutMs,
  );
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof AtlasReleaseError) throw error;
    throw new AtlasReleaseError(
      'github_unavailable',
      `No se pudo consultar GitHub Releases: ${error instanceof Error ? error.message : 'error de red'}.`,
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
