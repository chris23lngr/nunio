import { Button } from "@nunio/ui/components/button/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nunio/ui/components/sheet/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Trash2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { artifactsQuery } from "@/features/artifacts/api/artifact-queries";
import { kinds } from "@/features/artifacts/artifact-kinds";
import { createApiClient } from "@/lib/api-client";
import type { CourseTopic, TopicLevel } from "../api/course-queries";
import { coursePageQuery } from "../api/course-queries";
import { dayAgoText } from "../course-format";
import { topicLevels } from "../topic-levels";

/** How long the delete button waits for its second click. */
const armedMs = 4_000;

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h3 className="text-base font-medium text-base-800">{title}</h3>
      {children}
    </section>
  );
}

/** Says a part is empty, as a dashed box. */
function Empty({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-dashed border-base-200 py-6 text-center">
      <p className="text-sm font-medium text-base-800">{title}</p>
      <p className="text-xs text-base-500">{children}</p>
    </div>
  );
}

/** The four Understanding Levels as cards; the student's choice is the Level (ADR-0023). */
function LevelChoice({
  topic,
  level,
  disabled,
  onChange,
}: {
  topic: CourseTopic;
  level: TopicLevel;
  disabled: boolean;
  onChange: (level: TopicLevel) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby="topic-level-title"
      className="grid grid-cols-2 gap-4 sm:grid-cols-4"
    >
      {topicLevels.map(({ level: each, label, icon: Icon, color }) => {
        const picked = each === level;
        return (
          <label
            key={each}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg p-3 shadow-xs outline has-focus-visible:ring-2 has-focus-visible:ring-primary-500 has-focus-visible:ring-offset-4 has-focus-visible:ring-offset-white ${
              picked
                ? "bg-primary-50 outline-primary-500/70"
                : "bg-white outline-base-700/15 hover:bg-base-50"
            }`}
          >
            <span className="flex items-center justify-between">
              <Icon aria-hidden="true" className={`size-4 shrink-0 ${color}`} />
              <input
                type="radio"
                name={`topic-level-${topic.id}`}
                value={each}
                checked={picked}
                disabled={disabled}
                onChange={() => onChange(each)}
                aria-label={label}
                className="sr-only"
              />
              {/* Drawn rather than native: its see-through middle takes the card's color. */}
              <span
                aria-hidden="true"
                className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
                  picked ? "border-primary-500" : "border-base-300 bg-white"
                }`}
              >
                {picked && (
                  <span className="size-2 rounded-full bg-primary-500" />
                )}
              </span>
            </span>
            <span className="text-sm font-medium text-base-800">{label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Deletes on a second click within a few seconds; leaving the button disarms it. */
function DeleteButton({
  pending,
  onDelete,
}: {
  pending: boolean;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), armedMs);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      variant="destructive"
      className={`self-start ${armed ? "bg-destructive-50 outline-destructive-700/15" : ""}`}
      disabled={pending}
      onBlur={() => setArmed(false)}
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      {armed ? "Wirklich löschen?" : "Thema löschen"}
      <Trash2 aria-hidden="true" data-icon="inline-end" />
    </Button>
  );
}

const pagesText = (pages: number[]) =>
  `${pages.length === 1 ? "Seite" : "Seiten"} ${pages.join(", ")}`;

/** A Topic's details: the student's Level to change, the Artifacts made on it, where it is cited, and deleting it. */
export function TopicSheet({
  apiOrigin,
  courseId,
  topic,
  now,
  onClose,
}: {
  apiOrigin: string;
  courseId: string;
  /** The open Topic; none closes the sheet. */
  topic: CourseTopic | undefined;
  now: Date;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const artifacts = useQuery({
    ...artifactsQuery(apiOrigin),
    enabled: !!topic,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(coursePageQuery(apiOrigin, courseId)),
      // An Artifact is marked shaky by its Topics' Levels.
      queryClient.invalidateQueries(artifactsQuery(apiOrigin)),
    ]);
  const assess = useMutation({
    mutationFn: async ({ id, level }: { id: string; level: TopicLevel }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/topics/{id}/self-assessment",
        { params: { path: { id } }, body: { level } },
      );
      if (!result.data)
        throw new Error("Das hat nicht geklappt. Versuche es noch einmal.");
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      // Deleting a Topic rejects it, so a later reading does not bring it back.
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/review/{kind}/{id}/{action}",
        { params: { path: { kind: "fact", id, action: "reject" } } },
      );
      if (!result.data)
        throw new Error("Das Thema konnte nicht gelöscht werden.");
    },
    onSuccess: async () => {
      onClose();
      await refresh();
    },
  });
  const made =
    topic && artifacts.data?.filter((a) => a.topicIds.includes(topic.id));
  const level =
    assess.isPending && assess.variables.id === topic?.id
      ? assess.variables.level
      : topic?.level;
  return (
    <Sheet open={!!topic} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right">
        {topic && level && (
          <>
            <SheetHeader>
              <SheetTitle>{topic.title}</SheetTitle>
              <SheetDescription>
                Lernstatus, Artefakte und Quellen zu diesem Thema.
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="flex flex-col gap-12">
              <section className="flex flex-col gap-4">
                <h3
                  id="topic-level-title"
                  className="text-base font-medium text-base-800"
                >
                  Lernstatus
                </h3>
                <LevelChoice
                  topic={topic}
                  level={level}
                  disabled={assess.isPending}
                  onChange={(next) =>
                    assess.mutate({ id: topic.id, level: next })
                  }
                />
                {assess.error && (
                  <p role="alert" className="text-sm text-destructive-600">
                    {assess.error.message}
                  </p>
                )}
              </section>
              <Part title="Artefakte">
                {artifacts.error && (
                  <p role="alert" className="text-sm text-destructive-600">
                    {artifacts.error.message}
                  </p>
                )}
                {made?.length === 0 && (
                  <Empty title="Keine Artefakte">
                    Für dieses Thema existieren noch keine Artefakte.
                  </Empty>
                )}
                {!!made?.length && (
                  <ul aria-label="Artefakte" className="flex flex-col gap-3">
                    {made.map((artifact) => {
                      const { label, icon: Icon, color } = kinds[artifact.kind];
                      return (
                        <li
                          key={artifact.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Icon
                            aria-hidden="true"
                            className={`size-4 shrink-0 ${color}`}
                          />
                          <Link
                            href={`/artifacts/${encodeURIComponent(artifact.id)}`}
                            className="min-w-0 flex-1 truncate font-medium text-base-600 hover:text-base-800"
                          >
                            {artifact.title ?? label}
                          </Link>
                          <span className="ml-2 shrink-0 text-base-500">
                            {dayAgoText(artifact.createdAt, now)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Part>
              <Part title="Quellen">
                {topic.sources.length === 0 ? (
                  <Empty title="Keine Quellen">
                    Für dieses Thema existieren noch keine Quellen.
                  </Empty>
                ) : (
                  <ul aria-label="Quellen" className="flex flex-col gap-3">
                    {topic.sources.map((source) => (
                      <li key={source.id} className="flex items-start gap-2">
                        <File
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-base-500"
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium text-base-600">
                            {source.title}
                          </span>
                          <span className="text-xs text-base-500">
                            {pagesText(source.pages)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Part>
              <section aria-label="Löschen" className="flex flex-col">
                <h3 className="text-base font-medium text-base-800">Löschen</h3>
                <p className="mt-1 text-sm text-base-500">
                  Bist du dir sicher, dass du dieses Thema löschen möchtest?
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  <DeleteButton
                    pending={remove.isPending}
                    onDelete={() => remove.mutate(topic.id)}
                  />
                  {remove.error && (
                    <p role="alert" className="text-sm text-destructive-600">
                      {remove.error.message}
                    </p>
                  )}
                </div>
              </section>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
