// Own Work Activities (#306): promotion and cleanup only. Own Work is never parsed.
import { principal } from "@nunio/delegation";
import type { OwnWork } from "@nunio/knowledge";
import { log } from "./log.js";

export interface OwnWorkRef {
  studentId: string;
  fileId: string;
}

export function createOwnWorkActivities(ownWork: OwnWork) {
  return {
    /** Moves a snapshot of the upload from quarantine into sources; only the worker promotes (ADR-0007). */
    async promoteOwnWorkFile({ studentId, fileId }: OwnWorkRef) {
      return ownWork.promote(principal.fromSession({ studentId }), fileId);
    },
    /** Promotion gave up, as when nothing was uploaded: the student sees the file failed. */
    async failOwnWorkFile({ studentId, fileId }: OwnWorkRef) {
      log("own work promotion failed", { fileId });
      await ownWork.fail(principal.fromSession({ studentId }), fileId);
    },
    /** Deletes the file's key if the API did not, then every stored object and version. */
    async purgeOwnWorkFile({ studentId, fileId }: OwnWorkRef) {
      await ownWork.purge(principal.fromSession({ studentId }), fileId);
    },
  };
}

export type OwnWorkActivities = ReturnType<typeof createOwnWorkActivities>;
