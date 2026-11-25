"use client";

import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ObligationOption } from "@/features/artifacts/api/artifact-options-query";
import { artifactOptionsQuery } from "@/features/artifacts/api/artifact-options-query";
import type { ArtifactSummary } from "@/features/artifacts/api/artifact-queries";
import { artifactsQuery } from "@/features/artifacts/api/artifact-queries";
import type { CourseColor } from "@/features/courses/api/course-queries";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { CourseDot } from "@/features/shared/components/course-dot";
import { PageHeader } from "@/features/shared/components/page-header";
import type { Course, Level } from "./api/study-queries";
import { coursesQueries, levelsQueries } from "./api/study-queries";
import { AllTopics } from "./components/all-topics";
import type { StudyTopic } from "./components/next-topics";
import { NextTopics } from "./components/next-topics";
import { ObligationList } from "./components/obligation-list";
import { Understanding } from "./components/understanding";
import { daysUntil, handedIn } from "./study-format";

const topicFacts = (course: Course) =>
  course.facts.filter(
    (fact) => fact.type === "topic" && fact.state !== "rejected",
  );

/** Days until the Course's soonest upcoming exam, or null when none is ahead. */
function nextExamInDays(course: Course, now: Date) {
  const days = course.obligations
    .filter((o) => o.state !== "rejected" && o.kind === "exam")
    .map((o) => daysUntil(o.due, now))
    .filter((d): d is number => d !== null && d >= 0);
  return days.length ? Math.min(...days) : null;
}

/** Latest ready draft version per Obligation, drawn from the student's Artifacts. */
function draftVersions(artifacts: ArtifactSummary[] | undefined) {
  const map = new Map<string, number>();
  for (const artifact of artifacts ?? []) {
    if (
      artifact.kind !== "draft" ||
      artifact.status !== "ready" ||
      artifact.withdrawn ||
      !artifact.obligationId ||
      artifact.version === null
    )
      continue;
    const prev = map.get(artifact.obligationId);
    if (prev === undefined || artifact.version > prev)
      map.set(artifact.obligationId, artifact.version);
  }
  return map;
}

/** One Course's study panel: what to practise next, all Topics, Understanding spread, and Abgaben. */
function CoursePanel({
  apiOrigin,
  course,
  drafts,
  now,
}: {
  apiOrigin: string;
  course: Course;
  drafts: Map<string, number>;
  now: Date;
}) {
  const levels = useQuery(levelsQueries(apiOrigin, course.id));
  const options = useQuery(artifactOptionsQuery(apiOrigin, course.id));
  const levelByTopic = new Map<string, Level>(
    (levels.data ?? []).map((entry) => [entry.topicId, entry]),
  );
  const topics: StudyTopic[] = topicFacts(course).map((fact) => ({
    id: fact.id,
    title: fact.value,
    level: levelByTopic.get(fact.id) ?? {
      topicId: fact.id,
      level: "not_studied",
      latestAttempt: null,
      lastEvidenceAt: null,
    },
  }));
  const obligations = course.obligations.filter(
    (o) => o.state !== "rejected" && handedIn.includes(o.kind),
  );
  const rules = new Map<string, ObligationOption["aiUse"]["status"]>(
    (options.data?.obligations ?? []).map((o) => [o.id, o.aiUse.status]),
  );
  const examInDays = nextExamInDays(course, now);
  return (
    <div
      role="tabpanel"
      aria-labelledby={`course-tab-${course.id}`}
      className="flex flex-col gap-6"
    >
      {levels.error && (
        <p role="alert" className="text-sm text-destructive-600">
          {levels.error.message}
        </p>
      )}
      <div className="flex flex-col items-start gap-12 lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-10">
          <NextTopics
            apiOrigin={apiOrigin}
            courseId={course.id}
            topics={topics}
            examInDays={examInDays}
            now={now}
          />
          <AllTopics
            apiOrigin={apiOrigin}
            courseId={course.id}
            topics={topics}
            now={now}
          />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-10 lg:w-80">
          <Understanding topics={topics} />
          <ObligationList
            obligations={obligations}
            rules={rules}
            drafts={drafts}
            now={now}
          />
        </div>
      </div>
    </div>
  );
}

/** The student's Courses: each Topic's Understanding Level, practice on it, Self-assessment, and Abgaben. */
export function StudyScreen({
  apiOrigin,
  course: initialCourse,
}: {
  apiOrigin: string;
  course?: string;
}) {
  const courses = useQuery(coursesQueries(apiOrigin));
  const courseList = useQuery(courseListQuery(apiOrigin));
  const artifacts = useQuery(artifactsQuery(apiOrigin));
  const [selectedId, setSelectedId] = useState(initialCourse ?? "");
  const now = new Date();

  const colorsByCourse = new Map<string, CourseColor>();
  const archived = new Set<string>();
  for (const summary of courseList.data?.courses ?? []) {
    colorsByCourse.set(summary.id, summary.color);
    if (summary.archived) archived.add(summary.id);
  }
  const visible = (courses.data ?? []).filter(
    (entry) => !archived.has(entry.id),
  );
  const active =
    visible.find((entry) => entry.id === selectedId) ?? visible[0] ?? null;
  const drafts = draftVersions(artifacts.data);

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Lernen</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col gap-7 px-8 pt-24 pb-16">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium text-base-800">Lernen</h1>
          <p className="text-sm text-base-500">
            Wo du in jedem Kurs stehst und was du als Nächstes üben solltest.
          </p>
        </div>
        {courses.error && (
          <p role="alert" className="text-sm text-destructive-600">
            {courses.error.message}
          </p>
        )}
        {visible.length > 0 && (
          <div
            role="tablist"
            aria-label="Kurse"
            className="flex flex-wrap items-center gap-0.5 self-start rounded-lg bg-base-100 p-0.75"
          >
            {visible.map((entry) => {
              const selected = entry.id === active?.id;
              const color = colorsByCourse.get(entry.id);
              const count = topicFacts(entry).length;
              return (
                <button
                  key={entry.id}
                  id={`course-tab-${entry.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setSelectedId(entry.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.25 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                    selected
                      ? "bg-white text-base-800 shadow-[0_1px_2px_#0000001a] outline-1 outline-base-700/10"
                      : "text-base-600 hover:text-base-800",
                  )}
                >
                  {color && <CourseDot color={color} />}
                  <span>{entry.title}</span>
                  <span className="text-xs font-medium text-base-500">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {courses.data && visible.length === 0 && (
          <p className="rounded-xl border border-dashed border-base-200 px-6 py-10 text-center text-sm text-base-500">
            Noch keine Kurse. Sobald du Kurse anlegst oder Quellen hochlädst,
            erscheinen hier deine Themen und Abgaben.
          </p>
        )}
        {active && (
          <CoursePanel
            key={active.id}
            apiOrigin={apiOrigin}
            course={active}
            drafts={drafts}
            now={now}
          />
        )}
      </div>
    </main>
  );
}
