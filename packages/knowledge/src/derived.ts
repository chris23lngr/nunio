import { randomBytes } from "node:crypto";
import type { Transaction } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import {
  decryptDerivedText,
  encryptDerivedText,
  unwrapUnderSource,
  wrapUnderSource,
} from "@nunio/keys";

/** Text drawn from Sources, as stored: shredded with any of them (ADR-0007). */
export type Sealed = {
  content: Uint8Array<ArrayBuffer>;
  /** Null for text drawn from no Source, which holds no course material and is stored as is. */
  contentKey: Uint8Array<ArrayBuffer> | null;
  derivedFrom: string[];
};

/**
 * Seals text under its own key, wrapped in turn under the key of every Source it was drawn from, so deleting any of
 * those Sources shreds it. Chat answers, Artifacts and Feedback share it.
 */
export function createDerivedText(keys: SourceKeys) {
  /** The live Source keys, in order; null when any of them is gone. The caller zeroes them. */
  async function sourceKeys(tx: Transaction, sourceIds: readonly string[]) {
    const rows = await tx.source.findMany({
      where: { id: { in: [...sourceIds] }, deletedAt: null },
      select: { id: true, keyVersion: true, keyCiphertext: true },
    });
    const unwrapped: { id: string; key: Buffer }[] = [];
    for (const id of sourceIds) {
      const row = rows.find((r) => r.id === id);
      if (!row?.keyVersion || !row.keyCiphertext) {
        zero(unwrapped);
        return null;
      }
      unwrapped.push({
        id,
        key: keys.unwrap(id, {
          version: row.keyVersion,
          ciphertext: row.keyCiphertext,
        }),
      });
    }
    return unwrapped;
  }
  return {
    /** Seals `text` for the record `id`; null when a Source in `derivedFrom` is already gone. */
    async seal(
      tx: Transaction,
      id: string,
      derivedFrom: readonly string[],
      text: string,
    ): Promise<Sealed | null> {
      if (!derivedFrom.length)
        return {
          content: bytes(Buffer.from(text)),
          contentKey: null,
          derivedFrom: [],
        };
      const layers = await sourceKeys(tx, derivedFrom);
      if (!layers) return null;
      const contentKey = randomBytes(32);
      try {
        return {
          content: bytes(encryptDerivedText(contentKey, id, text)),
          contentKey: bytes(
            layers.reduce<Buffer>(
              (wrapped, { id: sourceId, key }) =>
                wrapUnderSource(key, sourceId, wrapped),
              contentKey,
            ),
          ),
          derivedFrom: [...derivedFrom],
        };
      } finally {
        contentKey.fill(0);
        zero(layers);
      }
    },
    /** The text sealed for `id`; null once any Source it was drawn from is deleted. */
    async open(
      tx: Transaction,
      id: string,
      sealed: Sealed,
    ): Promise<string | null> {
      if (!sealed.contentKey)
        return Buffer.from(sealed.content).toString("utf8");
      const layers = await sourceKeys(tx, sealed.derivedFrom);
      if (!layers) return null;
      // Unwraps through each Source key in reverse wrapping order.
      const contentKey = layers.reduceRight<Buffer>(
        (wrapped, { id: sourceId, key }) =>
          unwrapUnderSource(key, sourceId, wrapped),
        Buffer.from(sealed.contentKey),
      );
      try {
        return decryptDerivedText(contentKey, id, sealed.content);
      } finally {
        contentKey.fill(0);
        zero(layers);
      }
    },
  };
}
export type DerivedText = ReturnType<typeof createDerivedText>;

/** Prisma stores bytes from a Uint8Array over its own ArrayBuffer. */
const bytes = (buffer: Buffer) => new Uint8Array(buffer);
const zero = (layers: { key: Buffer }[]) => {
  for (const { key } of layers) key.fill(0);
};
