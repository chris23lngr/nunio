import type { LucideIcon } from "lucide-react";
import { BookOpenCheck, Layers, PencilRuler, ScanText } from "lucide-react";
import type { ArtifactKind } from "./api/artifact-queries";

/** How each kind of Artifact is named and drawn. */
export const kinds: Record<
  ArtifactKind,
  {
    label: string;
    /** What it counts, singular and plural; null for a text. */
    counted: [string, string] | null;
    icon: LucideIcon;
    color: string;
  }
> = {
  practice_set: {
    label: "Übungsset",
    counted: ["Aufgabe", "Aufgaben"],
    icon: BookOpenCheck,
    color: "text-success-500",
  },
  flashcards: {
    label: "Karteikarten",
    counted: ["Karteikarte", "Karteikarten"],
    icon: Layers,
    color: "text-purple-500",
  },
  draft: {
    label: "Entwurf",
    counted: null,
    icon: PencilRuler,
    color: "text-warning-500",
  },
  critique: {
    label: "Kritik",
    counted: null,
    icon: ScanText,
    color: "text-pink-500",
  },
};
