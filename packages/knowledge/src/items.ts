import type { Unsupported } from "@nunio/db";
import type { Transaction } from "@nunio/delegation";

/** An item no extraction supports anymore disappears, rejections included; a Correction keeps it as the student's own. */
export async function pruneItems(tx: Transaction, reason: Unsupported) {
  const unsupported = { extractions: { none: {} } };
  await tx.obligation.deleteMany({ where: { ...unsupported, correctedAt: null } });
  await tx.fact.deleteMany({ where: { ...unsupported, correctedAt: null } });
  await tx.obligation.updateMany({ where: { ...unsupported, unsupported: null }, data: { unsupported: reason } });
  await tx.fact.updateMany({ where: { ...unsupported, unsupported: null }, data: { unsupported: reason } });
  // Proposals and rejections nothing supports disappear too; an accepted Course is the student's own, and a merged
  // one keeps pointing at its target.
  await tx.course.deleteMany({ where: { status: { in: ["proposed", "rejected"] }, sources: { none: {} }, obligations: { none: {} }, facts: { none: {} } } });
}
