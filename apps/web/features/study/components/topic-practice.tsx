import { cn } from "@nunio/ui";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { createApiClient } from "@/lib/api-client";
import type { ArtifactRequest } from "../api/study-queries";
import type { LevelName } from "../study-format";
import { levels } from "../study-format";

type Practice = "practice_set" | "flashcards";

const making: Record<Practice, string> = {
  practice_set: "Übungsset wird erstellt",
  flashcards: "Karteikarten werden erstellt",
};

/** Asks nunio for a practice set or flashcards on one Topic, drawn from its Course. */
export function usePractice(
  apiOrigin: string,
  courseId: string,
  topicId: string,
) {
  return useMutation({
    mutationFn: async (kind: Practice) => {
      const body: ArtifactRequest = {
        kind,
        topicIds: [topicId],
        from: { selection: { courseIds: [courseId], sourceIds: [] } },
      };
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/artifacts",
        { body },
      );
      if (!result.data)
        throw new Error(
          "Das konnte nicht angefragt werden. Versuch es noch einmal.",
        );
      return { kind, artifactId: result.data.artifactId };
    },
  });
}

/** What nunio is making for the Topic, and the way to it. */
export function PracticeMaking({
  started,
}: {
  started: { kind: Practice; artifactId: string };
}) {
  return (
    <span className="flex items-center gap-2 text-[13px] leading-4.5">
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 animate-spin text-primary-500"
      />
      <span className="text-base-600">{making[started.kind]}</span>
      <span aria-hidden="true" className="text-base-300">
        ·
      </span>
      <Link
        href={`/artifacts/${started.artifactId}`}
        className="font-medium text-primary-600 hover:text-primary-700"
      >
        Öffnen
      </Link>
    </span>
  );
}

/** A Level's icon in its 20px lane. */
export function LevelIcon({
  level,
  className,
}: {
  level: LevelName;
  className?: string;
}) {
  const { icon: Icon, icon500 } = levels[level];
  return (
    <span className={cn("flex w-5 shrink-0", className)}>
      <Icon aria-hidden="true" className={cn("size-4", icon500)} />
    </span>
  );
}
