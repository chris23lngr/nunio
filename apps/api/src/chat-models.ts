import type { Answerer } from "@nunio/ai";
import type { CatalogModel, ModelCatalog, Principal } from "@nunio/delegation";

export interface ChatModelView {
  key: string;
  name: string;
  provider: string;
  description: string;
  /** Where the model processes student data (ADR-0011, ADR-0012), shown wherever a model is chosen. */
  dataHandling: {
    provider: "OpenRouter";
    upstream: string[];
    routing: "international";
    zeroRetention: true;
  };
  /** Computed from synced prices on every read, never stored. */
  cost: { relativeToDefault: number; tier: "low" | "medium" | "high" };
}

/** Input plus output price per million tokens below any long-context surcharge, for comparing Models. */
const basePrice = (model: CatalogModel) => {
  const tier = model.prices[0];
  return tier ? tier.inputMicroUsdPerMTok + tier.outputMicroUsdPerMTok : 0;
};

function cost(model: CatalogModel, reference: CatalogModel) {
  const ratio = basePrice(model) / basePrice(reference);
  return {
    relativeToDefault: Number(ratio.toPrecision(2)),
    tier: ratio < 0.5 ? "low" : ratio <= 1.5 ? "medium" : "high",
  } as const;
}

/** The Chat's Model choice: what a student may pick, and the answerer for the Model they picked. */
export function createChatModels({
  catalog,
  answererFor,
}: {
  catalog: ModelCatalog;
  answererFor: (model: CatalogModel) => Answerer;
}) {
  return {
    async list(p: Principal) {
      const [offered, selected] = await Promise.all([
        catalog.chatModels(),
        catalog.chatModelFor(p),
      ]);
      const reference =
        offered.find((model) => model.chatDefault) ?? offered[0];
      return {
        models: offered.map(
          (model): ChatModelView => ({
            key: model.key,
            name: model.name,
            provider: model.provider,
            description: model.description,
            dataHandling: {
              provider: "OpenRouter",
              upstream: [...model.upstream],
              routing: "international",
              zeroRetention: true,
            },
            cost: cost(model, reference!),
          }),
        ),
        default: reference?.key ?? null,
        selected: selected?.key ?? null,
      };
    },
    /** Null when `requested` is not offered, or nothing is; see `ModelCatalog.chatModelFor`. */
    async answererFor(p: Principal, requested?: string) {
      const model = await catalog.chatModelFor(p, requested);
      return model ? answererFor(model) : null;
    },
  };
}
export type ChatModels = ReturnType<typeof createChatModels>;
