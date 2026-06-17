/**
 * p2p.ts — map a human "topic" string to a QVAC provider identity.
 *
 * QVAC has no topic concept: a consumer delegates to a provider by its public
 * key (`dht.connect(publicKey)`), and the provider's key comes from the
 * QVAC_HYPERSWARM_SEED env var. To give a topic-style UX with no key-copying we
 * derive a deterministic seed from the topic and compute the SAME public key the
 * provider will advertise. Verified: hyperswarm/HyperDHT derive their identity
 * via `DHT.keyPair(seed)`, which is byte-identical to `hypercore-crypto.keyPair(seed)`.
 *
 * The topic string is effectively a PRE-SHARED SECRET: both sides must know it.
 */
import { createHash } from "node:crypto";
import hypercoreCrypto from "hypercore-crypto";

/** Deterministic 32-byte seed (hex) for a topic — set as QVAC_HYPERSWARM_SEED on the provider. */
export function topicToSeedHex(topic: string): string {
  return createHash("sha256").update(`lifeline:${topic}`).digest("hex");
}

/** The provider public key (hex) for a raw 32-byte seed (hex). */
export function seedHexToProviderKey(seedHex: string): string {
  const seed = Buffer.from(seedHex, "hex");
  const { publicKey } = hypercoreCrypto.keyPair(seed);
  return Buffer.from(publicKey).toString("hex");
}

/** The provider public key (hex) that `serve --topic <topic>` will advertise. */
export function topicToProviderKey(topic: string): string {
  return seedHexToProviderKey(topicToSeedHex(topic));
}
