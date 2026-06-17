// Minimal ambient declaration for hypercore-crypto (ships no types).
// We only use keyPair(seed) to derive a provider's public key from a topic seed.
declare module "hypercore-crypto" {
  export function keyPair(seed?: Buffer): { publicKey: Buffer; secretKey: Buffer };
}
