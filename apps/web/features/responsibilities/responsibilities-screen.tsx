"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId } from "react";
import { useAppForm } from "@/lib/form";
import { delegateResponsibility } from "./api/responsibility-mutations";
import {
  delegableCourseQueries,
  responsibilityListQueries,
} from "./api/responsibility-queries";
import { nameOf, pausedBecause } from "./name";

const states = { active: "active", paused: "paused", ended: "ended" } as const;

/** What the student delegated to nunio, and delegating one more Course or exam. */
export function ResponsibilitiesScreen({ apiOrigin }: { apiOrigin: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const delegated = useQuery(responsibilityListQueries(apiOrigin)).data ?? [];
  const courses = useQuery(delegableCourseQueries(apiOrigin)).data ?? [];
  // One mutation each, so each form shows only its own error.
  const create = useMutation(delegateResponsibility(apiOrigin, queryClient));
  const prepare = useMutation(delegateResponsibility(apiOrigin, queryClient));
  const exams = courses.flatMap((course) =>
    course.obligations
      .filter((o) => o.kind === "exam" && o.state !== "rejected")
      .map((o) => ({ id: o.id, label: `${o.title} (${course.title})` })),
  );

  const form = useAppForm({
    defaultValues: { courseId: "" },
    onSubmit: async ({ value }) => {
      await create
        .mutateAsync({
          preset: "keep_course_organized",
          courseId: value.courseId,
        })
        .catch(() => {
          // Query owns the mutation error, rendered below.
        });
    },
  });
  const examForm = useAppForm({
    defaultValues: { obligationId: "" },
    onSubmit: async ({ value }) => {
      await prepare
        .mutateAsync({
          preset: "prepare_for_exam",
          obligationId: value.obligationId,
        })
        .catch(() => {
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
            <Link href={`/responsibilities/${r.id}`}>{nameOf(r)}</Link> (
            {states[r.state]}
            {r.pausedBy &&
              pausedBecause[r.pausedBy] &&
              `, ${pausedBecause[r.pausedBy]}`}
            )
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
            <label htmlFor={`${id}-course`}>
              Course
              <Select
                items={courses.map((course) => ({
                  value: course.id,
                  label: course.title,
                }))}
                name={field.name}
                required
                value={field.state.value || null}
                onValueChange={(value) => field.handleChange(value ?? "")}
              >
                <SelectTrigger
                  id={`${id}-course`}
                  aria-label="Course"
                  onBlur={field.handleBlur}
                >
                  <SelectValue placeholder="Choose a Course" />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  sideOffset={8}
                  alignItemWithTrigger={false}
                >
                  <SelectGroup>
                    <SelectItem value="" disabled>
                      Choose a Course
                    </SelectItem>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void examForm.handleSubmit();
        }}
      >
        <examForm.Field
          name="obligationId"
          validators={{
            onChange: ({ value }) => (value ? undefined : "Choose an exam."),
          }}
        >
          {(field) => (
            <label htmlFor={`${id}-exam`}>
              Exam
              <Select
                items={exams.map((exam) => ({
                  value: exam.id,
                  label: exam.label,
                }))}
                name={field.name}
                required
                value={field.state.value || null}
                onValueChange={(value) => field.handleChange(value ?? "")}
              >
                <SelectTrigger
                  id={`${id}-exam`}
                  aria-label="Exam"
                  onBlur={field.handleBlur}
                >
                  <SelectValue placeholder="Choose an exam" />
                </SelectTrigger>
                <SelectContent
                  align="start"
                  sideOffset={8}
                  alignItemWithTrigger={false}
                >
                  <SelectGroup>
                    <SelectItem value="" disabled>
                      Choose an exam
                    </SelectItem>
                    {exams.map((exam) => (
                      <SelectItem key={exam.id} value={exam.id}>
                        {exam.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          )}
        </examForm.Field>
        <examForm.AppForm>
          <examForm.SubmitButton>
            Prepare me for this exam
          </examForm.SubmitButton>
        </examForm.AppForm>
        <p>
          nunio will plan and move Study Blocks for this exam every morning in
          the run-up to it.
        </p>
        {prepare.error && <p role="alert">{prepare.error.message}</p>}
      </form>
    </section>
  );
}
