"use client";

import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { buttonVariants } from "@nunio/ui/components/button/button";
import { useQuery } from "@tanstack/react-query";
import { Calendar, File, Plus, Tag } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/features/shared/components/page-header";
import { coursePageQuery, topicAreasQuery } from "./api/course-queries";
import { Agenda } from "./components/agenda";
import { CourseSources, UploadButton } from "./components/course-sources";
import { DisagreementCard } from "./components/disagreement-card";
import { TopicAreaList, TopicList } from "./components/topic-list";
import { TopicSheet } from "./components/topic-sheet";
import { colors, semesterLabel } from "./course-format";

/** One fact about the Course under its title, such as its code. */
function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm font-medium text-base-600 [&_svg]:size-4 [&_svg]:text-base-500">
      {icon}
      {children}
    </li>
  );
}

/** A section of the page: its title, an optional action, and its content. */
function Section({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col gap-5", className)}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-base-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A Course's page: its Topics with the student's Levels, its Sources, open Disagreements and what is coming up. */
export function CourseScreen({
  apiOrigin,
  id,
  topic,
}: {
  apiOrigin: string;
  id: string;
  /** The Topic whose details are open. */
  topic?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const page = useQuery(coursePageQuery(apiOrigin, id));
  // Without Areas, or while they load or fail, the Topics show as one flat list.
  const areas = useQuery(topicAreasQuery(apiOrigin, id)).data?.areas ?? [];
  const openTopic = (topicId: string | null) =>
    router.replace(topicId ? `${pathname}?topic=${topicId}` : pathname, {
      scroll: false,
    });
  const course = page.data?.course;
  const now = new Date();
  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>
                Dashboard
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/courses" />}>
                Kurse
              </BreadcrumbLink>
            </BreadcrumbItem>
            {course && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{course.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col px-8 pt-22 pb-16">
        {page.error && (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive-600">
              {page.error.message}
            </p>
            <Link
              href="/courses"
              className="text-sm font-medium text-primary-500 hover:text-primary-600"
            >
              Zu deinen Kursen
            </Link>
          </div>
        )}
        {page.data && course && (
          <>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-xs"
                style={{ backgroundColor: colors[course.color].swatch }}
              />
              <h1 className="min-w-0 truncate text-2xl leading-8 font-medium text-base-800">
                {course.title}
              </h1>
              {(course.status === "proposed" || course.archived) && (
                <span className="shrink-0 rounded-sm bg-base-100 px-1.5 text-xs leading-5 text-base-600">
                  {course.status === "proposed"
                    ? "Vorgeschlagen"
                    : "Archiviert"}
                </span>
              )}
              <span className="flex-1" />
              <Link href="/artifacts" className={buttonVariants()}>
                Lernen
              </Link>
            </div>
            <ul
              aria-label="Über den Kurs"
              className="mt-3 flex flex-wrap gap-x-6 gap-y-2 pl-5"
            >
              {course.code && (
                <Fact icon={<Tag aria-hidden="true" />}>{course.code}</Fact>
              )}
              <Fact icon={<Calendar aria-hidden="true" />}>
                {semesterLabel(course.semester)}
              </Fact>
              <Fact icon={<File aria-hidden="true" />}>
                {page.data.sources.length === 1
                  ? "1 Quelle"
                  : `${page.data.sources.length} Quellen`}
              </Fact>
            </ul>
            <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,42rem)_20rem] lg:justify-between lg:gap-8">
              <div className="flex min-w-0 flex-col gap-16">
                <DisagreementCard
                  apiOrigin={apiOrigin}
                  courseId={id}
                  disagreements={page.data.disagreements}
                />
                <Section
                  title="Themen"
                  action={
                    // Paper's action; the API cannot create a Topic yet.
                    <button
                      type="button"
                      disabled
                      className="flex cursor-not-allowed items-center gap-2 text-sm font-medium text-primary-500"
                    >
                      Erstellen
                      <Plus aria-hidden="true" className="size-4" />
                    </button>
                  }
                >
                  {page.data.topics.length && areas.length ? (
                    <TopicAreaList
                      areas={areas}
                      topics={page.data.topics}
                      now={now}
                      onOpen={openTopic}
                    />
                  ) : page.data.topics.length ? (
                    <TopicList
                      topics={page.data.topics}
                      now={now}
                      onOpen={openTopic}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-dashed border-base-200 py-6 text-center">
                      <p className="text-sm font-medium text-base-800">
                        Keine Themen
                      </p>
                      <p className="text-xs text-base-500">
                        Sobald nunio die Quellen des Kurses gelesen hat, stehen
                        hier seine Themen.
                      </p>
                    </div>
                  )}
                </Section>
                <Section
                  title="Quellen"
                  action={<UploadButton apiOrigin={apiOrigin} courseId={id} />}
                >
                  <CourseSources
                    apiOrigin={apiOrigin}
                    courseId={id}
                    sources={page.data.sources}
                    now={now}
                  />
                </Section>
              </div>
              <Section title="Termine" className="gap-4">
                <Agenda dated={page.data.dated} now={now} />
              </Section>
            </div>
          </>
        )}
      </div>
      <TopicSheet
        apiOrigin={apiOrigin}
        courseId={id}
        topic={page.data?.topics.find((t) => t.id === topic)}
        now={now}
        onClose={() => openTopic(null)}
      />
    </main>
  );
}
