import type { LucideIcon } from "lucide-react";
import {
  BookOpenCheck,
  PencilRuler,
  PlayingCardsFan,
  ScanText,
} from "lucide-react";
import type { ArtifactKind } from "./api/artifact-queries";

/** The badge for shaky Topics: Tailwind's orange 100 and 700, as in Paper; the theme drops that palette. */
export const shakyBadge =
  "bg-[oklch(95.4%_0.038_75.164)] text-[oklch(55.3%_0.195_38.402)]";

/** How each kind of Artifact is named and drawn. */
export const kinds: Record<
  ArtifactKind,
  {
    label: string;
    /** What it counts, singular and plural; null for a text. */
    counted: [string, string] | null;
    icon: LucideIcon;
    /** Tailwind's emerald, violet, amber and pink 500, as in Paper; the theme drops that palette. */
    color: string;
  }
> = {
  practice_set: {
    label: "Übungsset",
    counted: ["Aufgabe", "Aufgaben"],
    icon: BookOpenCheck,
    color: "text-[oklch(69.6%_0.17_162.48)]",
  },
  flashcards: {
    label: "Karteikarten",
    counted: ["Karteikarte", "Karteikarten"],
    icon: PlayingCardsFan,
    color: "text-[oklch(60.6%_0.25_292.717)]",
  },
  draft: {
    label: "Entwurf",
    counted: null,
    icon: PencilRuler,
    color: "text-[oklch(76.9%_0.188_70.08)]",
  },
  critique: {
    label: "Kritik",
    counted: null,
    icon: ScanText,
    color: "text-[oklch(65.6%_0.241_354.308)]",
  },
};
