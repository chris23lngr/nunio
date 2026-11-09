"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { FormEvent } from "react";
import { keepCourseOrganized } from "./api/responsibility-mutations";
import {
  delegableCourseQueries,
  responsibilityListQueries,
} from "./api/responsibility-queries";

const states = { active: "active", paused: "paused", ended: "ended" } as const;

/** What the student delegated to nunio, and delegating one more Course. */
export function ResponsibilitiesScreen({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const delegated = useQuery(responsibilityListQueries(apiOrigin)).data ?? [];
  const courses = useQuery(delegableCourseQueries(apiOrigin)).data ?? [];
  const create = useMutation(keepCourseOrganized(apiOrigin, queryClient));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const courseId = new FormData(event.currentTarget).get("course");
    if (typeof courseId === "string" && courseId) create.mutate(courseId);
  }

  return (
    <section aria-label="Responsibilities">
      <h1>Responsibilities</h1>
      <ul>
        {delegated.map((r) => (
          <li key={r.id}>
            <Link href={`/responsibilities/${r.id}`}>
              Keep {r.course?.title ?? "a Course that is gone"} organized
            </Link>{" "}
            ({states[r.state]}
            {r.pausedBy === "budget" && ", its Budget is used up"})
          </li>
        ))}
      </ul>
      <form onSubmit={submit}>
        <label>
          Course
          <select name="course" defaultValue="">
            <option value="" disabled>
              Choose a Course
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={create.isPending}>
          Keep this course organized
        </button>
        <p>
          nunio will plan and move Study Blocks for this Course every morning.
          Moving blocks you placed always asks you first.
        </p>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>
    </section>
  );
}
