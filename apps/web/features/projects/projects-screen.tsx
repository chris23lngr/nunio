"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button } from "@nunio/ui/components/button/button";
import { useQuery } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { useState } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { PageHeader } from "@/features/shared/components/page-header";
import { projectCoursesQuery, projectListQuery } from "./api/project-queries";
import { NewProjectSheet } from "./components/new-project-sheet";
import { ProjectRow } from "./components/project-row";

function NewProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="pr-2" onClick={onClick}>
      Neues Projekt
      <Plus aria-hidden="true" />
    </Button>
  );
}

/** Optional workspaces, such as exam preparation, over the student's Courses and toward at most one Obligation. */
export function ProjectsScreen({ apiOrigin }: { apiOrigin: string }) {
  const projects = useQuery(projectListQuery(apiOrigin));
  const courses = useQuery(projectCoursesQuery(apiOrigin));
  // Only for the Courses' colors; without them the rows still read.
  const summaries = useQuery(courseListQuery(apiOrigin));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    mode: "rename" | "delete";
  } | null>(null);

  const colors = new Map(
    (summaries.data?.courses ?? []).map((course) => [course.id, course.color]),
  );
  const known = courses.data ?? [];
  const empty = projects.data?.length === 0;
  const count = projects.data?.length ?? 0;

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Projekte</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <span className="flex-1" />
        {count > 0 && <NewProjectButton onClick={() => setCreating(true)} />}
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(56rem+4rem)] flex-col px-8 pt-30 pb-16">
        <div className="flex flex-col gap-1.5 pb-10">
          <h1 className="text-2xl font-medium tracking-[-0.01em] text-base-800">
            Projekte
          </h1>
          <p className="max-w-140 text-sm text-base-500">
            Ein Projekt bündelt Arbeit auf ein Ziel hin, etwa eine Klausur oder
            eine Abschlussarbeit, über einen oder mehrere Kurse.
          </p>
        </div>
        {projects.error && (
          <p role="alert" className="text-sm text-destructive-600">
            {projects.error.message}
          </p>
        )}
        {empty && (
          <div className="flex flex-col items-start gap-5 rounded-xl border border-dashed border-base-300 px-10 py-12">
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-lg bg-base-100"
            >
              <Target className="size-5 text-base-600" />
            </span>
            <div className="flex max-w-130 flex-col gap-1.5">
              <h2 className="text-base font-medium text-base-800">
                Noch keine Projekte
              </h2>
              <p className="text-sm text-base-500">
                Projekte sind optional. Leg eins an, wenn mehrere Kurse auf
                dasselbe Ziel hinführen, etwa die Klausurphase oder deine
                Abschlussarbeit.
              </p>
            </div>
            <ul className="flex flex-col gap-2">
              {[
                "Klausurvorbereitung über Statistics II und Microeconomics",
                "Bachelorarbeit mit Ziel „Abgabe“",
              ].map((example) => (
                <li key={example} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-1 shrink-0 rounded-xs bg-base-400"
                  />
                  <span className="text-[13px] leading-4.5 text-base-600">
                    {example}
                  </span>
                </li>
              ))}
            </ul>
            <NewProjectButton onClick={() => setCreating(true)} />
          </div>
        )}
        {count > 0 && (
          <div className="flex flex-col gap-4">
            <div
              aria-hidden="true"
              className="flex items-center gap-4 px-4 text-xs font-medium text-base-500"
            >
              <span className="flex-1 pl-12">
                {count === 1 ? "1 Projekt" : `${count} Projekte`}
              </span>
              <span className="w-60 shrink-0">Ziel</span>
              <span className="w-5 shrink-0" />
            </div>
            <ul aria-label="Projekte" className="flex flex-col gap-4">
              {projects.data?.map((project) => {
                // Named once the Courses are read; one no longer accepted still counts.
                const related = courses.isPending
                  ? []
                  : project.courseIds.map((id) => ({
                      id,
                      title:
                        known.find((course) => course.id === id)?.title ??
                        "Ein Kurs",
                      color: colors.get(id),
                    }));
                const obligation =
                  known
                    .flatMap((course) => course.obligations)
                    .find((o) => o.id === project.obligationId) ?? null;
                return (
                  <ProjectRow
                    key={project.id}
                    apiOrigin={apiOrigin}
                    project={project}
                    courses={related}
                    obligation={obligation}
                    coursesPending={courses.isPending}
                    editing={editing?.id === project.id ? editing.mode : null}
                    onEdit={(mode) =>
                      setEditing(mode ? { id: project.id, mode } : null)
                    }
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <NewProjectSheet
        apiOrigin={apiOrigin}
        open={creating}
        courses={known}
        coursesPending={courses.isPending}
        coursesError={courses.error?.message ?? null}
        colors={colors}
        onClose={() => setCreating(false)}
      />
    </main>
  );
}
