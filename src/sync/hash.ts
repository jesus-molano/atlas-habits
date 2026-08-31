export type HashText = (value: string) => Promise<string>;

/** SHA-256 for production. Kept behind a function so pure tests need no native runtime. */
export const sha256Hex: HashText = async (value) => {
  const { CryptoDigestAlgorithm, digestStringAsync } =
    await import('expo-crypto');
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
};
