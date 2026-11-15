"use client";

import type { paths } from "@nunio/api-client";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/features/shared/components/page-header";
import { SourceCitations } from "@/features/shared/components/source-citations";
import { createApiClient } from "@/lib/api-client";
import { attemptsQueries, coursesQueries } from "./api/study-queries";
import { PracticeSet } from "./practice-set";

type Artifact =
  paths["/api/me/artifacts/{id}"]["get"]["responses"][200]["content"]["application/json"];

const failures: Record<string, string> = {
  no_material: "nothing in your material matched.",
  allowance_exhausted: "your AI allowance is used up.",
  maker_failed: "the model did not answer. Please ask again.",
  gone: "something it was made from is gone.",
  ai_use_forbidden: "your course's rule on AI no longer allows it.",
  ai_use_unknown: "your course's rule on AI is no longer known.",
  ai_use_conditions: "your course's rule on AI changed.",
};
const kinds = {
  practice_set: "Übungsset",
  flashcards: "Karteikarten",
  draft: "Entwurf",
  critique: "Kritik",
};

/** When the student last practised, in words such as "vor 3 Tagen". */
function ago(date: Date, now = new Date()) {
  const format = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const;
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  return "gerade eben";
}

type Edited = { id?: string; front: string; back: string }[];
const saveErrors: Record<string, string> = {
  stale: "This changed meanwhile. Reload it before saving again.",
  withdrawn:
    "A Source it was made from was deleted, so it can no longer be changed.",
};

/** Saves the student's edit as a new version against the version it was based on. */
function useSaveVersion(apiOrigin: string, artifact: Artifact) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      content: { cards: Edited } | { text: string },
    ): Promise<number> => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/artifacts/{id}/versions",
        {
          params: { path: { id: artifact.id } },
          body: { baseVersion: artifact.version ?? 1, content },
        },
      );
      if (result.data) return result.data.version;
      const reason = (result.error as { error?: string } | undefined)?.error;
      throw new Error(saveErrors[reason ?? ""] ?? "Could not save it.");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [apiOrigin, "artifact", artifact.id],
      }),
  });
}

type Card = Extract<
  NonNullable<Artifact["content"]>,
  { cards: unknown }
>["cards"][number];

function FlashcardsEditor({
  apiOrigin,
  artifact,
  cards,
}: {
  apiOrigin: string;
  artifact: Artifact;
  cards: Card[];
}) {
  const [edited, setEdited] = useState<Edited>(() =>
    cards.map(({ id, front, back }) => ({ id, front, back })),
  );
  const save = useSaveVersion(apiOrigin, artifact);
  const change = (i: number, field: "front" | "back", value: string) =>
    setEdited((all) =>
      all.map((card, j) => (j === i ? { ...card, [field]: value } : card)),
    );
  return (
    <>
      <table aria-label="As Anki will import them">
        <thead>
          <tr>
            <th>Front</th>
            <th>Back</th>
          </tr>
        </thead>
        <tbody>
          {edited.map((card, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: A new card has no id until it is saved.
            <tr key={i}>
              <td>{card.front}</td>
              <td>{card.back}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <a href={`${apiOrigin}/api/me/artifacts/${artifact.id}/anki.tsv`}>
        Download for Anki
      </a>
      {edited.map((card, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: A new card has no id until it is saved.
        <fieldset key={i}>
          <label>
            Front of card {i + 1}
            <input
              value={card.front}
              onChange={(e) => change(i, "front", e.target.value)}
            />
          </label>
          <label>
            Back of card {i + 1}
            <textarea
              value={card.back}
              onChange={(e) => change(i, "back", e.target.value)}
            />
          </label>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setEdited((all) => [...all, { front: "", back: "" }])}
      >
        Add a card
      </Button>
      <Button
        type="button"
        variant="primary"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            cards: edited.map(({ id, front, back }) =>
              id ? { id, front, back } : { front, back },
            ),
          })
        }
      >
        Save as a new version
      </Button>
      {save.isSuccess && <p>Saved as version {save.data}.</p>}
      {save.error && <p role="alert">{save.error.message}</p>}
    </>
  );
}

/** A draft the student reworks, saved as new versions; it keeps only the citations its text still uses. */
function DraftEditor({
  apiOrigin,
  artifact,
  text,
}: {
  apiOrigin: string;
  artifact: Artifact;
  text: string;
}) {
  const [edited, setEdited] = useState(text);
  const save = useSaveVersion(apiOrigin, artifact);
  return (
    <>
      <label>
        Draft
        <textarea value={edited} onChange={(e) => setEdited(e.target.value)} />
      </label>
      <Button
        type="button"
        variant="primary"
        disabled={save.isPending}
        onClick={() => save.mutate({ text: edited })}
      >
        Save as a new version
      </Button>
      {save.isSuccess && <p>Saved as version {save.data}.</p>}
      {save.error && <p role="alert">{save.error.message}</p>}
    </>
  );
}

/** One Artifact under its title: polled while it is made, then a practice set to answer, flashcards or a draft. */
export function ArtifactScreen({
  apiOrigin,
  id,
  pollMs = 2000,
}: {
  apiOrigin: string;
  id: string;
  pollMs?: number;
}) {
  const query = useQuery({
    queryKey: [apiOrigin, "artifact", id],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/artifacts/{id}",
        { params: { path: { id } }, signal },
      );
      if (!result.data) throw new Error("Could not load this.");
      return result.data;
    },
    refetchInterval: (q) =>
      q.state.data?.status === "making" ? pollMs : false,
  });
  const artifact = query.data;
  const practice =
    artifact?.content && "items" in artifact.content ? artifact.content : null;
  // Without a title of its own, an Artifact is named by its Topics.
  const courses = useQuery({
    ...coursesQueries(apiOrigin),
    enabled: !!artifact && !practice?.title,
  });
  const attempts = useQuery({
    ...attemptsQueries(apiOrigin, id),
    enabled: !!practice,
  });
  const topics = (courses.data ?? [])
    .flatMap((course) => course.facts)
    .filter((fact) => artifact?.topicIds.includes(fact.id))
    .map((fact) => fact.value);
  const title =
    practice?.title ??
    (topics.length
      ? new Intl.ListFormat("de", { type: "conjunction" }).format(topics)
      : artifact
        ? kinds[artifact.kind]
        : "");
  const practised = (attempts.data ?? [])
    .map((attempt) => new Date(attempt.createdAt))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/study" />}>
                Lernen
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>Artefakte</BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="block max-w-60 truncate">
                {title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-5xl flex-col px-6 pt-22 pb-16">
        <Link
          href="/study"
          className="flex items-center gap-2 self-start text-sm leading-5 font-medium text-primary-600 hover:text-primary-700"
        >
          <ChevronLeft aria-hidden className="size-4 text-primary-500" />
          Zurück
        </Link>
        <h1 className="mt-4 text-2xl leading-8 font-medium text-base-800">
          {title}
        </h1>
        {practised && (
          <p className="mt-2 text-base leading-6 text-base-500">
            Zuletzt gelernt {ago(practised)}
          </p>
        )}
        <div className="mt-16 flex flex-col gap-4">
          {query.error && <p role="alert">{query.error.message}</p>}
          {artifact?.status === "making" && <p>Being made…</p>}
          {artifact?.status === "failed" && (
            <p role="alert">
              This could not be made:{" "}
              {failures[artifact.failure ?? ""] ?? artifact.failure}
            </p>
          )}
          {artifact?.withdrawn && (
            <p>
              A Source it was made from was deleted, so its content is gone.
            </p>
          )}
          {practice && (
            <PracticeSet
              apiOrigin={apiOrigin}
              artifactId={id}
              items={practice.items}
            />
          )}
          {artifact?.content && "text" in artifact.content && (
            <>
              {artifact.kind === "draft" ? (
                <DraftEditor
                  apiOrigin={apiOrigin}
                  artifact={artifact}
                  text={artifact.content.text}
                />
              ) : (
                <p>{artifact.content.text}</p>
              )}
              <SourceCitations citations={artifact.content.citations} />
            </>
          )}
          {artifact?.content && "cards" in artifact.content && (
            <FlashcardsEditor
              apiOrigin={apiOrigin}
              artifact={artifact}
              cards={artifact.content.cards}
            />
          )}
        </div>
      </div>
    </main>
  );
}
