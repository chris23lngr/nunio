import type { ActionArgs, Transaction } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import {
  decryptActionArguments,
  digestActionArguments,
  encryptActionArguments,
} from "@nunio/keys";

/**
 * The gate's `actionArgs` port: an Integration Action's tool arguments, sealed and digested under its Connection's
 * content key and bound to the Action, so Disconnect shreds them with the key (#266). Each answers null once the
 * Connection, and with it the key, is gone.
 */
export function createActionArgs({ keys }: { keys: SourceKeys }): ActionArgs {
  const keyOf = async (tx: Transaction, connectionId: string) => {
    const row = await tx.connection.findUnique({
      where: { id: connectionId },
      select: { keyVersion: true, keyCiphertext: true },
    });
    return (
      row &&
      keys.unwrapConnectionKey(connectionId, {
        version: row.keyVersion,
        ciphertext: row.keyCiphertext,
      })
    );
  };
  return {
    async digest(tx, connectionId, canonicalArguments) {
      const key = await keyOf(tx, connectionId);
      return key && digestActionArguments(key, canonicalArguments);
    },
    async seal(tx, { id, connectionId }, toolArguments) {
      const key = await keyOf(tx, connectionId);
      return (
        key &&
        new Uint8Array(
          encryptActionArguments(key, id, JSON.stringify(toolArguments)),
        )
      );
    },
    async open(tx, { id, connectionId }, sealed) {
      const key = await keyOf(tx, connectionId);
      return (
        key &&
        (JSON.parse(decryptActionArguments(key, id, sealed)) as Record<
          string,
          unknown
        >)
      );
    },
  };
}
