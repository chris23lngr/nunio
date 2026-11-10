"use client";

import type { paths } from "@nunio/api-client";
import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createApiClient } from "@/lib/api-client";

type Artifact =
  paths["/api/me/artifacts/{id}"]["get"]["responses"][200]["content"]["application/json"];
type Attempt =
  paths["/api/me/attempts/{id}/grade"]["post"]["responses"][200]["content"]["application/json"];
type Citation = Attempt extends { feedback: infer F }
  ? NonNullable<F> extends { citations: (infer C)[] }
    ? C
    : never
  : never;

const failures: Record<string, string> = {
  no_material: "nothing in your material matched.",
  allowance_exhausted: "your AI allowance is used up.",
  maker_failed: "the model did not answer. Please ask again.",
  gone: "something it was made from is gone.",
  ai_use_forbidden: "your course's rule on AI no longer allows it.",
  ai_use_unknown: "your course's rule on AI is no longer known.",
  ai_use_conditions: "your course's rule on AI changed.",
};
const verdicts = {
  correct: "Correct",
  partial: "Partly correct",
  incorrect: "Not yet correct",
};

function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <ul>
      {citations.map(({ tag, provenance }) => (
        <li key={tag}>
          [{tag}]{" "}
          {provenance === "gone"
            ? "Its Source was deleted"
            : provenance.kind === "source"
              ? `${provenance.title}, page ${provenance.location.page}`
              : "Your own entry"}
        </li>
      ))}
    </ul>
  );
}

type Item = Extract<
  NonNullable<Artifact["content"]>,
  { items: unknown }
>["items"][number];

function PracticeItem({
  apiOrigin,
  artifactId,
  item,
}: {
  apiOrigin: string;
  artifactId: string;
  item: Item;
}) {
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState<
    Attempt | { id: string; verdict: null } | null
  >(null);
  const check = useMutation({
    mutationFn: async () => {
      const result = await createApiClient(apiOrigin).POST("/api/me/attempts", {
        body: { artifactId, itemId: item.id, text },
      });
      if (!result.data) throw new Error("Could not save your answer.");
      setAttempt(
        result.data.status === "graded"
          ? result.data.attempt
          : { id: result.data.attemptId, verdict: null },
      );
    },
  });
  const grade = useMutation({
    mutationFn: async (id: string) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/attempts/{id}/grade",
        { params: { path: { id } } },
      );
      if (!result.data) throw new Error("Could not grade your answer.");
      setAttempt(result.data);
    },
  });
  return (
    <article aria-label={item.question}>
      <h2>{item.question}</h2>
      <Citations citations={item.citations} />
      <label>
        Your answer
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <Button
        type="button"
        variant="primary"
        disabled={check.isPending || !text.trim()}
        onClick={() => check.mutate()}
      >
        Check my answer
      </Button>
      {attempt && attempt.verdict === null && (
        <p>
          Your answer is saved, but could not be graded yet.{" "}
          <Button
            type="button"
            variant="ghost"
            disabled={grade.isPending}
            onClick={() => grade.mutate(attempt.id)}
          >
            Grade again
          </Button>
        </p>
      )}
      {attempt && "feedback" in attempt && attempt.verdict && (
        <section aria-label="Feedback">
          <p>{verdicts[attempt.verdict]}</p>
          {attempt.feedback && (
            <>
              <p>{attempt.feedback.text}</p>
              <Citations citations={attempt.feedback.citations} />
            </>
          )}
        </section>
      )}
      {(check.error ?? grade.error) && (
        <p role="alert">{(check.error ?? grade.error)!.message}</p>
      )}
    </article>
  );
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

/** One Artifact: polled while it is made, then a practice set to answer, flashcards or a draft. */
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
  return (
    <>
      {query.error && <p role="alert">{query.error.message}</p>}
      {artifact?.status === "making" && <p>Being made…</p>}
      {artifact?.status === "failed" && (
        <p role="alert">
          This could not be made:{" "}
          {failures[artifact.failure ?? ""] ?? artifact.failure}
        </p>
      )}
      {artifact?.withdrawn && (
        <p>A Source it was made from was deleted, so its content is gone.</p>
      )}
      {artifact?.content &&
        "items" in artifact.content &&
        artifact.content.items.map((item) => (
          <PracticeItem
            key={item.id}
            apiOrigin={apiOrigin}
            artifactId={artifact.id}
            item={item}
          />
        ))}
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
          <Citations citations={artifact.content.citations} />
        </>
      )}
      {artifact?.content && "cards" in artifact.content && (
        <FlashcardsEditor
          apiOrigin={apiOrigin}
          artifact={artifact}
          cards={artifact.content.cards}
        />
      )}
    </>
  );
}
