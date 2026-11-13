"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/headings";
import { planQuery } from "@/features/plan/api/plan-queries";
import { createApiClient } from "@/lib/api-client";
import type { CourseImpact, CourseSummary } from "./api/course-queries";
import { courseImpactQuery, courseListQuery } from "./api/course-queries";
import { ConfirmDialog } from "./components/confirm-dialog";
import { CourseCard } from "./components/course-card";
import type { CourseFields } from "./components/course-dialog";
import { CourseDialog } from "./components/course-dialog";
import type { CourseAction } from "./components/course-menu";
import { CourseMenu } from "./components/course-menu";
import { CourseRoutines } from "./components/course-routines";
import { EmptyState } from "./components/empty-state";
import { ProposalStrip } from "./components/proposal-strip";
import { SemesterFilter } from "./components/semester-filter";
import type { Clash } from "./course-format";
import {
  archiveText,
  clashText,
  deleteText,
  semesterLabel,
} from "./course-format";

const failed = "Das hat nicht geklappt. Versuche es noch einmal.";

/** The request each Course action sends; a dialog in between, if any, is the screen's concern. */
const requests = {
  edit: (client: Client, id: string, fields?: CourseFields) =>
    client.PATCH("/api/me/courses/{id}", {
      params: { path: { id } },
      body: fields ?? {},
    }),
  archive: (client: Client, id: string) =>
    client.POST("/api/me/courses/{id}/archive", { params: { path: { id } } }),
  unarchive: (client: Client, id: string) =>
    client.POST("/api/me/courses/{id}/unarchive", {
      params: { path: { id } },
    }),
  reject: (client: Client, id: string) =>
    client.POST("/api/me/courses/{id}/decision", {
      params: { path: { id } },
      body: { decision: "reject" },
    }),
  delete: (client: Client, id: string) =>
    client.DELETE("/api/me/courses/{id}", { params: { path: { id } } }),
} satisfies Record<CourseAction, unknown>;
type Client = ReturnType<typeof createApiClient>;

/** What archiving or deleting touches, once loaded; a failed load can be retried in place. */
function ImpactText({
  impact,
  describe,
}: {
  impact: { data?: CourseImpact; isError: boolean; refetch: () => unknown };
  describe: (impact: CourseImpact) => string;
}) {
  if (impact.data) return <p>{describe(impact.data)}</p>;
  if (impact.isError)
    return (
      <div className="flex flex-col items-start gap-2">
        <p>Was davon betroffen ist, konnte nicht geladen werden.</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void impact.refetch()}
        >
          Erneut laden
        </Button>
      </div>
    );
  return <p>Einen Moment …</p>;
}

/** The student's Courses by Semester. `semester` comes from the URL; without it, the current one shows. */
export function CoursesScreen({
  apiOrigin,
  semester,
}: {
  apiOrigin: string;
  semester?: string;
}) {
  const router = useRouter();
  const list = useQuery(courseListQuery(apiOrigin));
  const plan = useQuery(planQuery(apiOrigin));
  const queryClient = useQueryClient();
  /** A Routine change or skip: the Plan's Tasks follow it, so the Plan is read again. */
  const routine = useMutation({
    mutationFn: async (
      change:
        | {
            seriesId: string;
            minutes: { preparationMinutes: number; followUpMinutes: number };
          }
        | { seriesId: string; until: Date },
    ) => {
      const client = createApiClient(apiOrigin);
      const params = { path: { id: change.seriesId } };
      const { response } =
        "until" in change
          ? await client.POST("/api/me/event-series/{id}/routine/skip", {
              params,
              body: { until: change.until.toISOString() },
            })
          : await client.PUT("/api/me/event-series/{id}/routine", {
              params,
              body: change.minutes,
            });
      if (!response.ok) throw new Error(failed);
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: planQuery(apiOrigin).queryKey,
      }),
  });
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<{
    action: Exclude<CourseAction, "unarchive">;
    course: CourseSummary;
  } | null>(null);
  const impact = useQuery({
    ...courseImpactQuery(apiOrigin, acting?.course.id ?? ""),
    enabled: acting?.action === "archive" || acting?.action === "delete",
  });
  const reload = () =>
    queryClient.invalidateQueries({
      queryKey: courseListQuery(apiOrigin).queryKey,
    });
  const accepted = (list.data?.courses ?? []).filter(
    (course) => course.status === "accepted",
  );
  const proposals = (list.data?.courses ?? []).filter(
    (course) => course.status === "proposed",
  );
  const create = useMutation({
    mutationFn: async (fields: CourseFields) => {
      const { error, response } = await createApiClient(apiOrigin).POST(
        "/api/me/courses",
        {
          body: {
            title: fields.title,
            code: fields.code,
            semester: fields.semester,
          },
        },
      );
      if (response.status === 409)
        throw new Error(clashText((error as { course: Clash }).course));
      if (!response.ok)
        throw new Error("Der Kurs konnte nicht angelegt werden.");
    },
    onSuccess: async () => {
      await reload();
      setCreating(false);
    },
  });
  /** One change to a Course; a clash on edit names the Course that has the name. */
  const courseChange = useMutation({
    mutationFn: async ({
      action,
      course,
      fields,
    }: {
      action: CourseAction;
      course: CourseSummary;
      fields?: CourseFields;
    }) => {
      const { response, error } = await requests[action](
        createApiClient(apiOrigin),
        course.id,
        fields,
      );
      if (response.status === 409 && action === "edit")
        throw new Error(clashText((error as { course: Clash }).course));
      if (!response.ok) throw new Error(failed);
    },
    onSuccess: async () => {
      await reload();
      setActing(null);
    },
  });
  /** Unarchiving needs no confirmation; every other action opens its dialog first. */
  const startAction = (course: CourseSummary, action: CourseAction) => {
    courseChange.reset();
    if (action === "unarchive") courseChange.mutate({ action, course });
    else setActing({ action, course });
  };
  const closeAction = () => {
    setActing(null);
    courseChange.reset();
  };
  const proposalDecision = useMutation({
    mutationFn: async ({
      course,
      decision,
    }: {
      course: CourseSummary;
      decision: "accept" | "reject";
    }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/courses/{id}/decision",
        { params: { path: { id: course.id } }, body: { decision } },
      );
      if (!result.data) throw new Error(failed);
    },
    onSettled: reload,
  });
  // A Semester from the URL that is neither offered nor any Course's, such as a mistyped link, shows the current one.
  const known = new Set([
    "all",
    ...(list.data?.choices ?? []),
    ...accepted.map((course) => course.semester),
  ]);
  const selected =
    semester && known.has(semester) ? semester : list.data?.current;
  // The server lists Courses in overview order already.
  const shown = accepted.filter(
    (course) => selected === "all" || course.semester === selected,
  );
  const select = (semester: string) =>
    router.replace(
      semester === list.data?.current
        ? "/courses"
        : `/courses?semester=${semester}`,
      { scroll: false },
    );

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col px-6 py-10">
      <nav
        aria-label="Brotkrumen"
        className="text-sm font-medium text-base-500"
      >
        Kurse
      </nav>
      <header className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <PageHeading>Kurse</PageHeading>
        {list.data && selected && (
          <div className="flex items-center gap-4">
            <SemesterFilter
              current={list.data.current}
              withCourses={accepted.map((course) => course.semester)}
              selected={selected}
              onSelect={select}
            />
            <Button onClick={() => setCreating(true)}>
              Erstellen
              <Plus data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        )}
      </header>
      {proposals.length > 0 && (
        <ProposalStrip
          proposals={proposals}
          pending={proposalDecision.isPending}
          error={proposalDecision.error?.message ?? null}
          onDecide={(course, decision) =>
            proposalDecision.mutate({ course, decision })
          }
        />
      )}
      {list.isPending && (
        <ul
          aria-hidden="true"
          className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-30 animate-pulse rounded-xl bg-base-100" />
          ))}
        </ul>
      )}
      {list.isError && (
        <div role="alert" className="mt-16 flex flex-col items-start gap-3">
          <p className="text-sm text-base-600">{list.error.message}</p>
          <Button variant="outline" onClick={() => void list.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      )}
      {list.data && selected && shown.length === 0 && (
        <EmptyState
          kind={
            accepted.length > 0
              ? "semester"
              : proposals.length > 0
                ? "proposals"
                : "none"
          }
          semester={
            selected === "all" ? "allen Semestern" : semesterLabel(selected)
          }
          onCreate={() => setCreating(true)}
        />
      )}
      {list.data && selected && shown.length > 0 && (
        <ul
          aria-label={
            selected === "all"
              ? "Kurse aller Semester"
              : `Kurse in ${semesterLabel(selected)}`
          }
          className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
        >
          {shown.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              menu={
                <CourseMenu
                  course={course}
                  onAction={(action) => startAction(course, action)}
                />
              }
            >
              <CourseRoutines
                series={(plan.data?.eventSeries ?? []).filter(
                  (s) => s.state === "confirmed" && s.courseId === course.id,
                )}
                onSave={(seriesId, minutes) =>
                  routine.mutate({ seriesId, minutes })
                }
                onSkip={(seriesId, until) =>
                  routine.mutate({ seriesId, until })
                }
              />
            </CourseCard>
          ))}
        </ul>
      )}
      {list.data && creating && (
        <CourseDialog
          initial={{
            title: "",
            code: null,
            semester:
              selected && selected !== "all" ? selected : list.data.current,
          }}
          choices={list.data.choices}
          pending={create.isPending}
          error={create.error?.message ?? null}
          onClose={() => {
            setCreating(false);
            create.reset();
          }}
          onSubmit={(fields) => create.mutate(fields)}
        />
      )}
      {list.data && acting?.action === "edit" && (
        <CourseDialog
          initial={{
            title: acting.course.title,
            code: acting.course.code,
            semester: acting.course.semester,
            color: acting.course.color,
          }}
          choices={list.data.choices}
          pending={courseChange.isPending}
          error={courseChange.error?.message ?? null}
          onClose={closeAction}
          onSubmit={(fields) =>
            courseChange.mutate({
              action: "edit",
              course: acting.course,
              fields,
            })
          }
        />
      )}
      {acting?.action === "archive" && (
        <ConfirmDialog
          title={`„${acting.course.title}“ archivieren?`}
          confirm="Archivieren"
          ready={impact.isSuccess}
          pending={courseChange.isPending}
          error={courseChange.error?.message ?? null}
          onCancel={closeAction}
          onConfirm={() =>
            courseChange.mutate({ action: "archive", course: acting.course })
          }
        >
          <ImpactText impact={impact} describe={archiveText} />
          <p className="mt-2">
            Alles bleibt erhalten, und du kannst die Archivierung jederzeit
            aufheben.
          </p>
        </ConfirmDialog>
      )}
      {acting?.action === "delete" && (
        <ConfirmDialog
          title={`„${acting.course.title}“ löschen?`}
          confirm="Endgültig löschen"
          destructive
          ready={impact.isSuccess}
          pending={courseChange.isPending}
          error={courseChange.error?.message ?? null}
          onCancel={closeAction}
          onConfirm={() =>
            courseChange.mutate({ action: "delete", course: acting.course })
          }
        >
          <ImpactText impact={impact} describe={deleteText} />
          <p className="mt-2">
            Liest nunio deine Quellen später erneut, kann es den Kurs wieder
            vorschlagen.
            {!acting.course.entered &&
              " Willst du ihn nie wieder sehen, lehne ihn stattdessen ab."}
          </p>
        </ConfirmDialog>
      )}
      {acting?.action === "reject" && (
        <ConfirmDialog
          title={`„${acting.course.title}“ ablehnen?`}
          confirm="Ablehnen"
          pending={courseChange.isPending}
          error={courseChange.error?.message ?? null}
          onCancel={closeAction}
          onConfirm={() =>
            courseChange.mutate({ action: "reject", course: acting.course })
          }
        >
          <p>
            Du sagst nunio, dass dieser Kurs nicht deiner ist. Er verschwindet
            aus deiner Übersicht und taucht auch bei neuen Quellen nicht wieder
            auf. Unter Prüfen kannst du ihn als Vorschlag wiederherstellen.
          </p>
        </ConfirmDialog>
      )}
    </main>
  );
}
