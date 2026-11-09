"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useAppForm } from "@/lib/form";
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

  const form = useAppForm({
    defaultValues: { courseId: "" },
    onSubmit: async ({ value }) => {
      await create.mutateAsync(value.courseId).catch(() => {
        // Query owns the mutation error, rendered below.
      });
    },
  });

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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="courseId"
          validators={{
            onChange: ({ value }) => (value ? undefined : "Choose a Course."),
          }}
        >
          {(field) => (
            <label>
              Course
              <select
                name={field.name}
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              >
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
          )}
        </form.Field>
        <form.AppForm>
          <form.SubmitButton>Keep this course organized</form.SubmitButton>
        </form.AppForm>
        <p>
          nunio will plan and move Study Blocks for this Course every morning.
          Moving blocks you placed always asks you first.
        </p>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>
    </section>
  );
}
