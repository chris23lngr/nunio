import type {
  ModelConfig,
  PriceTier,
  ReasoningEffort,
  SyncedModel,
} from "@nunio/ai";
import { isCoveredModel } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type { Clock } from "./gate.js";
import type { Principal } from "./principal.js";
import { withOwner } from "./principal.js";

/** A Model as the Chat picker and the answer call need it. */
export interface CatalogModel extends ModelConfig {
  name: string;
  provider: string;
  description: string;
  chatDefault: boolean;
}

/** Prices older than this stop a Model from being used, so a broken sync cannot leave estimates wrong for long. */
const freshFor = 7 * 24 * 60 * 60 * 1000;

type Row = Awaited<
  ReturnType<PrismaClient["catalogModel"]["findMany"]>
>[number];

function fromRow(row: Row): CatalogModel {
  return {
    key: row.key,
    providerModelId: row.providerModelId,
    reasoningEffort: row.reasoningEffort as ReasoningEffort,
    maxOutputTokens: row.maxOutputTokens,
    prices: (row.prices ?? []) as unknown as PriceTier[],
    upstream: row.upstream,
    name: row.name,
    provider: row.provider,
    description: row.description,
    chatDefault: row.chatDefault,
  };
}

/** The Model Catalog (ADR-0017): founder-managed Models and their synced prices. */
export function createModelCatalog({
  db,
  clock,
}: {
  db: PrismaClient;
  clock: Clock;
}) {
  /** Usable anywhere: a zero-retention endpoint, prices synced recently, and never a Covered Model. */
  const usable = (row: Row) =>
    row.zeroRetentionAvailable &&
    row.prices !== null &&
    row.syncedAt !== null &&
    clock.now().getTime() - row.syncedAt.getTime() <= freshFor &&
    !isCoveredModel(row.providerModelId);
  const offeredInChat = async () =>
    (
      await db.catalogModel.findMany({
        where: { chatEnabled: true },
        orderBy: [{ position: "asc" }, { key: "asc" }],
      })
    ).filter(usable);
  return {
    /** The Models a student may choose for Chat answers, in the founder's order. */
    async chatModels(): Promise<CatalogModel[]> {
      return (await offeredInChat()).map(fromRow);
    },
    /**
     * The Model to answer with. A `requested` key is remembered as the student's choice when offered and
     * refused (null) when not; without one, the remembered choice while offered, else the Chat default.
     */
    async chatModelFor(
      p: Principal,
      requested?: string,
    ): Promise<CatalogModel | null> {
      const offered = await offeredInChat();
      if (requested !== undefined) {
        const chosen = offered.find((row) => row.key === requested);
        if (!chosen) return null;
        await withOwner(db, p, (tx, studentId) =>
          tx.chatPreference.upsert({
            where: { studentId },
            create: { studentId, modelKey: chosen.key },
            update: { modelKey: chosen.key },
          }),
        );
        return fromRow(chosen);
      }
      const remembered = await withOwner(db, p, (tx, studentId) =>
        tx.chatPreference.findUnique({ where: { studentId } }),
      );
      const chosen =
        offered.find((row) => row.key === remembered?.modelKey) ??
        offered.find((row) => row.chatDefault);
      return chosen ? fromRow(chosen) : null;
    },
    /** Every priced Model that is not retired, for task defaults (`taskModels` in @nunio/ai) to resolve. */
    async taskModels(): Promise<ModelConfig[]> {
      const rows = await db.catalogModel.findMany({
        where: { retiredAt: null },
      });
      return rows
        .filter(
          (row) => row.prices !== null && !isCoveredModel(row.providerModelId),
        )
        .map(fromRow);
    },
    /** The OpenRouter models the price sync reads, so nothing else in OpenRouter's list can stop it. */
    async providerModelIds(): Promise<string[]> {
      const rows = await db.catalogModel.findMany({
        where: { retiredAt: null },
        distinct: ["providerModelId"],
        select: { providerModelId: true },
      });
      return rows.map((row) => row.providerModelId);
    },
    /**
     * Records OpenRouter's zero-retention prices for every Model. A Model missing from `synced` has no
     * zero-retention endpoint now, so it stops being used until one returns. Never writes the founder's switches.
     */
    async applySync(synced: ReadonlyMap<string, SyncedModel>): Promise<void> {
      const syncedAt = clock.now();
      const rows = await db.catalogModel.findMany({
        select: { key: true, providerModelId: true },
      });
      await db.$transaction(
        rows.map((row) => {
          const model = synced.get(row.providerModelId);
          return db.catalogModel.update({
            where: { key: row.key },
            data: model
              ? {
                  prices: model.prices as unknown as object[],
                  upstream: model.upstream,
                  zeroRetentionAvailable: true,
                  syncedAt,
                }
              : { zeroRetentionAvailable: false, syncedAt },
          });
        }),
      );
    },
  };
}
export type ModelCatalog = ReturnType<typeof createModelCatalog>;
