"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Popover, PopoverContent } from "@nunio/ui/components/popover/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isSameDay } from "date-fns";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { PageHeader } from "@/features/shared/components/page-header";
import { createApiClient } from "@/lib/api-client";
import type { PlanMove } from "./api/plan-queries";
import { planQuery } from "./api/plan-queries";
import { CalendarEntry } from "./components/calendar-entry";
import { DayHeader } from "./components/day-header";
import { EntryDetails } from "./components/entry-details";
import { PlanLegend } from "./components/plan-legend";
import { ProtectedTimeBlock } from "./components/protected-time-block";
import { SuggestionsButton } from "./components/suggestions-button";
import { SuggestionsSheet } from "./components/suggestions-sheet";
import { WeekGrid } from "./components/week-grid";
import type { DisplayOptions } from "./components/week-toolbar";
import { WeekToolbar } from "./components/week-toolbar";
import type { CourseColors } from "./plan-entries";
import {
  blockDetails,
  planEntries,
  plannedMinutes,
  planSuggestions,
  protectedRanges,
  timedMoves,
} from "./plan-entries";
import { weekDays } from "./plan-week";

/** The student's week: Fixed Events, Study Blocks, nunio's suggestions and Protected Time. */
export function PlanScreen({
  apiOrigin,
  today = new Date(),
}: {
  apiOrigin: string;
  today?: Date;
}) {
  const [week, setWeek] = useState(today);
  const [display, setDisplay] = useState<DisplayOptions>({
    weekends: true,
    suggestions: true,
    protectedTime: true,
    calendar: true,
  });
  const plan = useQuery(planQuery(apiOrigin));
  const courses = useQuery(courseListQuery(apiOrigin));
  const colors = useMemo<CourseColors>(
    () =>
      Object.fromEntries(
        (courses.data?.courses ?? []).map((course) => [
          course.id,
          course.color,
        ]),
      ),
    [courses.data],
  );
  const days = weekDays(week).slice(0, display.weekends ? 7 : 5);
  const [sheetOpen, setSheetOpen] = useState(false);
  const queryClient = useQueryClient();
  const apply = useMutation({
    mutationFn: async (move: PlanMove) => {
      const { response } = await createApiClient(apiOrigin).POST(
        "/api/me/plan/apply",
        { body: move },
      );
      if (response.status === 409)
        throw new Error(
          "Dein Plan hat sich inzwischen geändert. Hier sind die neuen Vorschläge.",
        );
      if (!response.ok)
        throw new Error("Der Vorschlag konnte nicht übernommen werden.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: planQuery(apiOrigin).queryKey,
      }),
  });
  const suggestions = plan.data ? planSuggestions(plan.data) : [];
  const [selected, setSelected] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const details =
    plan.data && selected ? blockDetails(plan.data, selected, colors) : null;
  const block = useMutation({
    mutationFn: async (
      action: { id: string; locked: boolean } | { id: string; delete: true },
    ) => {
      const client = createApiClient(apiOrigin);
      const path = { path: { id: action.id } };
      const { response } =
        "delete" in action
          ? await client.DELETE("/api/me/study-blocks/{id}", { params: path })
          : await client.POST("/api/me/study-blocks/{id}/lock", {
              params: path,
              body: { locked: action.locked },
            });
      if (!response.ok)
        throw new Error("Der Lernblock konnte nicht geändert werden.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: planQuery(apiOrigin).queryKey,
      }),
  });

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
              <BreadcrumbPage>Plan</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="flex flex-col items-center px-8 pt-22 pb-6">
        <div className="flex w-full max-w-5xl items-center justify-between">
          <h1 className="text-2xl font-medium text-base-800">Dein Plan</h1>
          <SuggestionsButton
            count={suggestions.length}
            onClick={() => setSheetOpen(true)}
          />
        </div>
        <div className="h-8" />
        <div className="w-full max-w-5xl">
          <WeekToolbar
            week={week}
            today={today}
            onWeekChange={setWeek}
            display={display}
            onDisplayChange={setDisplay}
          />
        </div>
        <div className="h-6" />
        {plan.isPending && (
          <p className="text-sm text-base-500">Dein Plan wird geladen …</p>
        )}
        {plan.isError && (
          <p role="alert" className="text-sm text-base-700">
            {plan.error.message}
          </p>
        )}
        {plan.data && (
          <div className="w-full max-w-7xl">
            <WeekGrid
              days={days}
              // One shaded hour on either side of the study window.
              fromHour={Math.max(
                0,
                Math.floor(plan.data.limits.preferences.studyFromMinute / 60) -
                  1,
              )}
              toHour={Math.min(
                24,
                Math.ceil(plan.data.limits.preferences.studyToMinute / 60) + 1,
              )}
              header={(day) => (
                <DayHeader
                  date={day}
                  plannedMinutes={plannedMinutes(plan.data, day)}
                  goalMinutes={plan.data.limits.preferences.maxMinutesPerDay}
                  today={isSameDay(day, today)}
                />
              )}
              background={
                display.protectedTime
                  ? protectedRanges(plan.data, days).map((range) => ({
                      ...range,
                      node: <ProtectedTimeBlock />,
                    }))
                  : []
              }
              entries={planEntries(plan.data, colors)
                .filter(
                  (entry) =>
                    (entry.kind !== "proposal" || display.suggestions) &&
                    (entry.kind !== "fixed" || display.calendar),
                )
                .map((entry) => ({
                  id: entry.id,
                  start: entry.start,
                  end: entry.end,
                  render: (form) => (
                    <div
                      className="h-full w-full"
                      ref={(element) => {
                        if (element) cards.current.set(entry.id, element);
                        else cards.current.delete(entry.id);
                      }}
                    >
                      <CalendarEntry
                        kind={entry.kind}
                        title={entry.title}
                        start={entry.start}
                        end={entry.end}
                        course={entry.course}
                        placedByStudent={entry.placedByStudent}
                        locked={entry.locked}
                        selected={entry.id === selected}
                        onSelect={
                          entry.kind === "study"
                            ? () => setSelected(entry.id)
                            : undefined
                        }
                        {...form}
                      />
                    </div>
                  ),
                }))}
            />
          </div>
        )}
        {plan.data && (
          <div className="mt-6 w-full max-w-5xl">
            <PlanLegend />
          </div>
        )}
      </div>
      <Popover
        open={details !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <PopoverContent
          anchor={selected ? cards.current.get(selected) : undefined}
          side="right"
          align="start"
          className="w-76 gap-0 p-0"
        >
          {details && selected && (
            <EntryDetails
              {...details}
              today={today}
              onLockChange={(locked) => block.mutate({ id: selected, locked })}
              onDelete={() => {
                block.mutate({ id: selected, delete: true });
                setSelected(null);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      <SuggestionsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        suggestions={suggestions}
        busy={apply.isPending}
        error={apply.error?.message}
        onAccept={(suggestion) => {
          const timed = plan.data
            ? timedMoves(plan.data).find((m) => m.id === suggestion.id)
            : undefined;
          if (timed) apply.mutate(timed.move);
        }}
      />
    </main>
  );
}
