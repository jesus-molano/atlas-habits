export type RandomByteSource = (bytes: Uint8Array) => void;

let fallbackSequence = 0;

function fillRandomBytes(bytes: Uint8Array): void {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    // `bytes` is created from a normal ArrayBuffer in createUuid. TS 6 keeps
    // SharedArrayBuffer in the generic Uint8Array surface, while Web Crypto
    // intentionally accepts only ArrayBuffer-backed views.
    cryptoObject.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
    return;
  }

  // Hermes normally exposes Web Crypto. This fallback keeps IDs available in
  // unusual runtimes (tests and older JS engines) without another dependency.
  fallbackSequence = (fallbackSequence + 1) >>> 0;
  let seed = (Date.now() ^ fallbackSequence) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = (seed >>> 24) ^ Math.floor(Math.random() * 256);
  }
}

export function formatUuidV4(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error('A UUID requires exactly 16 bytes.');
  }

  const value = Uint8Array.from(bytes);
  value[6] = (value[6] & 0x0f) | 0x40;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = Array.from(value, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createUuid(
  randomSource: RandomByteSource = fillRandomBytes,
): string {
  const bytes = new Uint8Array(16);
  randomSource(bytes);
  return formatUuidV4(bytes);
}
