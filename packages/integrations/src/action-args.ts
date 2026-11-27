import type { ActionArgs, Transaction } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import { decryptActionArguments, encryptActionArguments } from "@nunio/keys";

/**
 * The gate's `actionArgs` port: an Integration Action's tool arguments, sealed under its Connection's content key and
 * bound to the Action, so Disconnect shreds them with the key (#266).
 */
export function createActionArgs({ keys }: { keys: SourceKeys }): ActionArgs {
  const keyOf = async (tx: Transaction, connectionId: string) => {
    const row = await tx.connection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { keyVersion: true, keyCiphertext: true },
    });
    return keys.unwrapConnectionKey(connectionId, {
      version: row.keyVersion,
      ciphertext: row.keyCiphertext,
    });
  };
  return {
    async seal(tx, { id, connectionId }, toolArguments) {
      return new Uint8Array(
        encryptActionArguments(
          await keyOf(tx, connectionId),
          id,
          JSON.stringify(toolArguments),
        ),
      );
    },
    async open(tx, { id, connectionId }, sealed) {
      return JSON.parse(
        decryptActionArguments(await keyOf(tx, connectionId), id, sealed),
      ) as Record<string, unknown>;
    },
  };
}
