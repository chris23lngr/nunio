"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button } from "@nunio/ui/components/button/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { PageHeader } from "@/features/shared/components/page-header";
import type { ArtifactKind } from "./api/artifact-queries";
import { artifactsQuery } from "./api/artifact-queries";
import { kinds } from "./artifact-kinds";
import { ArtifactCard } from "./components/artifact-card";
import { CreateArtifactSheet } from "./components/create-artifact-sheet";

const filters = Object.entries(kinds).map(([kind, { label }]) => ({
  kind: kind as ArtifactKind,
  label,
}));
const isKind = (kind: string | undefined): kind is ArtifactKind =>
  filters.some((filter) => filter.kind === kind);

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-5.5 rounded-full px-2.5 text-xs font-medium outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
        pressed
          ? "bg-primary-200 text-primary-900 outline-primary-400"
          : "text-base-800 outline-base-700/15 hover:bg-base-50"
      }`}
    >
      {children}
    </button>
  );
}

/** The student's Artifacts, however they were made: in a Chat, on the Study page or here. */
export function ArtifactsScreen({
  apiOrigin,
  kind,
  create,
  course,
  pollMs = 2000,
}: {
  apiOrigin: string;
  /** The kind to show, from the address; any other shows all. */
  kind?: string;
  /** Opens the sheet to create one: "1", or the kind to start with. */
  create?: string;
  /** The Course the sheet starts with. */
  course?: string;
  /** How often to ask again while an Artifact is being made. */
  pollMs?: number;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const shown = isKind(kind) ? kind : null;
  const go = (next: { kind: ArtifactKind | null; create?: boolean }) => {
    const query = new URLSearchParams();
    if (next.kind) query.set("kind", next.kind);
    if (next.create) query.set("create", "1");
    const search = query.toString();
    router.replace(search ? `/artifacts?${search}` : "/artifacts", {
      scroll: false,
    });
  };
  const show = (next: ArtifactKind | null) => go({ kind: next });
  const openSheet = () => go({ kind: shown, create: true });
  const closeSheet = () => go({ kind: shown });
  const artifacts = useQuery({
    ...artifactsQuery(apiOrigin),
    refetchInterval: (q) =>
      q.state.data?.some((a) => a.status === "making") ? pollMs : false,
  });
  const courses = useQuery(courseListQuery(apiOrigin));
  const courseTitle = (id: string | null) =>
    courses.data?.courses.find((course) => course.id === id)?.title;
  const visible = artifacts.data?.filter(
    (artifact) => !shown || artifact.kind === shown,
  );
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
              <BreadcrumbPage>Artefakte</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col px-8 pt-22 pb-16">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl leading-8 font-medium text-base-800">
            Artefakte
          </h1>
          <Button onClick={openSheet}>Erstellen</Button>
        </div>
        <fieldset
          aria-label="Nach Typ filtern"
          className="mt-8 flex flex-wrap gap-2"
        >
          <FilterChip pressed={!shown} onClick={() => show(null)}>
            Alle
          </FilterChip>
          {filters.map((filter) => (
            <FilterChip
              key={filter.kind}
              pressed={shown === filter.kind}
              onClick={() => show(filter.kind)}
            >
              {filter.label}
            </FilterChip>
          ))}
        </fieldset>
        {artifacts.error && (
          <p role="alert" className="mt-8 text-sm text-destructive-600">
            {artifacts.error.message}
          </p>
        )}
        {artifacts.data?.length === 0 && (
          <div className="mx-auto mt-24 flex max-w-sm flex-col items-start gap-4">
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-md border border-dashed border-base-300 text-base-500"
            >
              <FileSearch className="size-5" />
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-medium text-base-800">
                Noch keine Artefakte
              </h2>
              <p className="text-sm leading-6 text-base-600">
                Erstelle ein Artefakt aus deinen Kursunterlagen oder bitte nunio
                im Chat darum.
              </p>
            </div>
            <Button variant="outline" onClick={openSheet}>
              Erstellen
            </Button>
          </div>
        )}
        {/* Waits for the Courses too, so their names do not pop in. */}
        {!!visible?.length && !courses.isPending && (
          <ul
            aria-label="Artefakte"
            className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3"
          >
            {visible.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                course={courseTitle(artifact.courseId)}
                now={now}
              />
            ))}
          </ul>
        )}
        {!!artifacts.data?.length && visible?.length === 0 && (
          <p className="mt-6 text-sm text-base-600">
            Du hast noch keine Artefakte dieses Typs.
          </p>
        )}
      </div>
      <CreateArtifactSheet
        // A fresh sheet each time it opens, with the kind and Course it was opened for.
        key={create ? `${create}-${course ?? ""}` : "closed"}
        apiOrigin={apiOrigin}
        open={!!create}
        initialKind={isKind(create) ? create : (shown ?? undefined)}
        initialCourseId={course}
        onClose={closeSheet}
        onCreated={() => {
          closeSheet();
          queryClient.invalidateQueries({
            queryKey: artifactsQuery(apiOrigin).queryKey,
          });
        }}
      />
    </main>
  );
}
