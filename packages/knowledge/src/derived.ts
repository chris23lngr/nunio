import { randomBytes } from "node:crypto";
import type { Transaction } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import {
  decryptDerivedText,
  encryptDerivedText,
  unwrapUnderConnection,
  unwrapUnderSource,
  wrapUnderConnection,
  wrapUnderSource,
} from "@nunio/keys";

/** Text drawn from Sources and Connections, as stored: shredded with any of them (ADR-0007, #266). */
export type Sealed = {
  content: Uint8Array<ArrayBuffer>;
  /** Null for text drawn from no Source or Connection, which holds no course material and is stored as is. */
  contentKey: Uint8Array<ArrayBuffer> | null;
  derivedFrom: string[];
  /**
   * The Connections it was drawn from, wrapped after the Sources. Only records that can draw on a Connection have it:
   * Chat messages, RunSteps, Runs, Notices and Briefings.
   */
  derivedFromConnections?: string[];
};

/** Why sealed text can no longer be opened; a Disconnect wins over a deleted Source. */
export type GoneReason = "source_deleted" | "connection_disconnected";

/** Sealed text opened: the text, or why it is gone. */
export type Opened =
  | { text: string; gone: null }
  | { text: null; gone: GoneReason };

/** A key the content key is wrapped under, in wrapping order. */
type Layer = { kind: "source" | "connection"; id: string; key: Buffer };

/**
 * Seals text under its own key, wrapped in turn under the key of every Source and then every Connection it was drawn
 * from, so deleting any of those Sources or Disconnecting any of those Connections shreds it. Chat answers, Runs,
 * Notices, Briefings, Artifacts and Feedback share it.
 */
export function createDerivedText(keys: SourceKeys) {
  /** The live Source and Connection rows with their wrapped keys, or why one of them is gone. */
  async function rowsOf(
    tx: Transaction,
    sourceIds: readonly string[],
    connectionIds: readonly string[],
  ) {
    const [sources, connections] = await Promise.all([
      sourceIds.length
        ? tx.source.findMany({
            where: { id: { in: [...sourceIds] }, deletedAt: null },
            select: { id: true, keyVersion: true, keyCiphertext: true },
          })
        : [],
      connectionIds.length
        ? tx.connection.findMany({
            where: { id: { in: [...connectionIds] } },
            select: { id: true, keyVersion: true, keyCiphertext: true },
          })
        : [],
    ]);
    // Disconnect deletes the Connection row with its key.
    if (connectionIds.some((id) => !connections.some((row) => row.id === id)))
      return "connection_disconnected";
    if (
      sourceIds.some((id) => {
        const row = sources.find((r) => r.id === id);
        return !row?.keyVersion || !row.keyCiphertext;
      })
    )
      return "source_deleted";
    return { sources, connections };
  }
  /** The live keys, in wrapping order, or why one of them is gone. The caller zeroes them. */
  async function layersOf(
    tx: Transaction,
    sourceIds: readonly string[],
    connectionIds: readonly string[],
  ): Promise<Layer[] | GoneReason> {
    const rows = await rowsOf(tx, sourceIds, connectionIds);
    if (typeof rows === "string") return rows;
    const layers: Layer[] = [];
    try {
      for (const id of sourceIds) {
        const row = rows.sources.find((r) => r.id === id)!;
        layers.push({
          kind: "source",
          id,
          key: keys.unwrap(id, {
            version: row.keyVersion!,
            ciphertext: row.keyCiphertext!,
          }),
        });
      }
      for (const id of connectionIds) {
        const row = rows.connections.find((r) => r.id === id)!;
        layers.push({
          kind: "connection",
          id,
          key: keys.unwrapConnectionKey(id, {
            version: row.keyVersion,
            ciphertext: row.keyCiphertext,
          }),
        });
      }
      return layers;
    } catch (error) {
      zero(layers);
      throw error;
    }
  }
  return {
    /**
     * Seals `text` for the record `id`; null when a Source in `derivedFrom` is already gone or a Connection in
     * `derivedFromConnections` is already Disconnected. Only records that have the column pass Connections.
     */
    async seal(
      tx: Transaction,
      id: string,
      derivedFrom: readonly string[],
      text: string,
      derivedFromConnections?: readonly string[],
    ): Promise<Sealed | null> {
      const connections = derivedFromConnections && {
        derivedFromConnections: [...derivedFromConnections],
      };
      if (!derivedFrom.length && !derivedFromConnections?.length)
        return {
          content: bytes(Buffer.from(text)),
          contentKey: null,
          derivedFrom: [],
          ...connections,
        };
      const layers = await layersOf(
        tx,
        derivedFrom,
        derivedFromConnections ?? [],
      );
      if (typeof layers === "string") return null;
      const contentKey = randomBytes(32);
      try {
        return {
          content: bytes(encryptDerivedText(contentKey, id, text)),
          contentKey: bytes(
            layers.reduce<Buffer>(
              (wrapped, layer) => wrap(layer, wrapped),
              contentKey,
            ),
          ),
          derivedFrom: [...derivedFrom],
          ...connections,
        };
      } finally {
        contentKey.fill(0);
        zero(layers);
      }
    },
    /** The text sealed for `id`, or why it is gone: a Source it was drawn from deleted, or a Connection Disconnected. */
    async open(tx: Transaction, id: string, sealed: Sealed): Promise<Opened> {
      if (!sealed.contentKey)
        return {
          text: Buffer.from(sealed.content).toString("utf8"),
          gone: null,
        };
      const layers = await layersOf(
        tx,
        sealed.derivedFrom,
        sealed.derivedFromConnections ?? [],
      );
      if (typeof layers === "string") return { text: null, gone: layers };
      let contentKey: Buffer | undefined;
      try {
        // Unwraps through each key in reverse wrapping order.
        contentKey = layers.reduceRight<Buffer>(
          (wrapped, layer) => unwrap(layer, wrapped),
          Buffer.from(sealed.contentKey),
        );
        return {
          text: decryptDerivedText(contentKey, id, sealed.content),
          gone: null,
        };
      } finally {
        contentKey?.fill(0);
        zero(layers);
      }
    },
    /** Why text drawn from these Sources and Connections can't be sealed now; null while all of them are there. */
    async gone(
      tx: Transaction,
      derivedFrom: readonly string[],
      derivedFromConnections: readonly string[] = [],
    ): Promise<GoneReason | null> {
      const rows = await rowsOf(tx, derivedFrom, derivedFromConnections);
      return typeof rows === "string" ? rows : null;
    },
  };
}
export type DerivedText = ReturnType<typeof createDerivedText>;

const wrap = ({ kind, id, key }: Layer, data: Buffer) =>
  kind === "source"
    ? wrapUnderSource(key, id, data)
    : wrapUnderConnection(key, id, data);
const unwrap = ({ kind, id, key }: Layer, data: Buffer) =>
  kind === "source"
    ? unwrapUnderSource(key, id, data)
    : unwrapUnderConnection(key, id, data);
/** Prisma stores bytes from a Uint8Array over its own ArrayBuffer. */
const bytes = (buffer: Buffer) => new Uint8Array(buffer);
const zero = (layers: { key: Buffer }[]) => {
  for (const { key } of layers) key.fill(0);
};
