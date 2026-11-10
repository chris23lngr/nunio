"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { createApiClient } from "@/lib/api-client";
import type { ArtifactRequest, Course, Level } from "./api/study-queries";
import { coursesQueries, levelsQueries } from "./api/study-queries";

/** A Level in words: coarse on purpose, and disputed shows both sides. */
function levelText(level: Level | undefined) {
  if (!level) return "";
  if (level.level === "disputed")
    return `Disputed: your Attempts say ${level.fromAttempts}, but you said ${level.selfAssessment}.`;
  return {
    not_yet_practiced: "Not yet practiced",
    shaky: "Shaky",
    solid: "Solid",
  }[level.level];
}

const opened = { practice_set: "practice set", flashcards: "flashcards" };

function TopicCard({
  apiOrigin,
  courseId,
  topic,
  level,
}: {
  apiOrigin: string;
  courseId: string;
  topic: Course["facts"][number];
  level: Level | undefined;
}) {
  const queryClient = useQueryClient();
  const make = useMutation({
    mutationFn: async (kind: "practice_set" | "flashcards") => {
      const body: ArtifactRequest = {
        kind,
        topicIds: [topic.id],
        from: { selection: { courseIds: [courseId], sourceIds: [] } },
      };
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/artifacts",
        { body },
      );
      if (!result.data) throw new Error("Could not ask for that.");
      return { kind, artifactId: result.data.artifactId };
    },
  });
  const assess = useMutation({
    mutationFn: async (assessed: "shaky" | "solid") => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/topics/{id}/self-assessment",
        { params: { path: { id: topic.id } }, body: { level: assessed } },
      );
      if (!result.data) throw new Error("Could not record that.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: levelsQueries(apiOrigin, courseId).queryKey,
      }),
  });
  return (
    <article aria-label={topic.value}>
      <h3>{topic.value}</h3>
      <p>{levelText(level)}</p>
      {level?.selfAssessment && level.level !== "disputed" && (
        <p>You said {level.selfAssessment}.</p>
      )}
      {level?.lastEvidenceAt && (
        <p>
          Last evidence {new Date(level.lastEvidenceAt).toLocaleDateString()}
        </p>
      )}
      <Button
        type="button"
        variant="primary"
        disabled={make.isPending}
        onClick={() => make.mutate("practice_set")}
      >
        Practice
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={make.isPending}
        onClick={() => make.mutate("flashcards")}
      >
        Flashcards
      </Button>
      {make.data && (
        <p>
          Being made.{" "}
          <Link href={`/study/artifacts/${make.data.artifactId}`}>
            Open the {opened[make.data.kind]}
          </Link>
        </p>
      )}
      {make.error && <p role="alert">{make.error.message}</p>}
      <Button
        type="button"
        variant="ghost"
        disabled={assess.isPending}
        onClick={() => assess.mutate("shaky")}
      >
        I feel shaky
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={assess.isPending}
        onClick={() => assess.mutate("solid")}
      >
        I feel solid
      </Button>
      {assess.isSuccess && <p>Noted.</p>}
      {assess.error && <p role="alert">{assess.error.message}</p>}
    </article>
  );
}

/** Assessed work nunio may help with: exams and registrations are not handed in. */
const handedIn = ["assignment", "presentation", "thesis", "other"];
const writtenAs = { draft: "draft", critique: "Critique" };

type WriteRequest = Extract<ArtifactRequest, { kind: "draft" | "critique" }>;
type Written =
  | { started: { kind: WriteRequest["kind"]; artifactId: string } }
  | { refused: string };

/** What the student needs to hand it in themselves; nothing is sent anywhere. */
function HandoffPanel({
  apiOrigin,
  obligationId,
}: {
  apiOrigin: string;
  obligationId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = [apiOrigin, "handoff", obligationId];
  const handoff = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/obligations/{id}/handoff",
        { params: { path: { id: obligationId } }, signal },
      );
      if (!result.data) throw new Error("Could not prepare the Handoff.");
      return result.data;
    },
  });
  const report = useMutation({
    mutationFn: async (reported: boolean) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/obligations/{id}/reported-submitted",
        { params: { path: { id: obligationId } }, body: { reported } },
      );
      if (!result.data) throw new Error("Could not record that.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const view = handoff.data;
  return (
    <section aria-label="Handoff">
      <h4>Handoff</h4>
      {handoff.error && <p role="alert">{handoff.error.message}</p>}
      {view && (
        <>
          <p>
            {view.obligation.destination
              ? `Hand it in at: ${view.obligation.destination} (as your Source says; nunio has not checked it).`
              : "Your Sources do not say where to hand it in."}
          </p>
          {view.rule.status === "conditional" && (
            <p>
              {view.rule.text ??
                "You said your course allows AI under conditions; keep to them."}
            </p>
          )}
          <ul>
            {view.drafts.map((draft) => (
              <li key={draft.id}>
                <Link href={`/study/artifacts/${draft.id}`}>
                  Draft, version {draft.version}
                </Link>
              </li>
            ))}
          </ul>
          {view.obligation.reportedSubmittedAt ? (
            <p>
              You reported it as handed in on{" "}
              {new Date(view.obligation.reportedSubmittedAt).toLocaleString()}.{" "}
              <Button
                type="button"
                variant="ghost"
                disabled={report.isPending}
                onClick={() => report.mutate(false)}
              >
                Take that back
              </Button>
            </p>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={report.isPending}
              onClick={() => report.mutate(true)}
            >
              I handed it in
            </Button>
          )}
        </>
      )}
      {report.error && <p role="alert">{report.error.message}</p>}
    </section>
  );
}

function ObligationCard({
  apiOrigin,
  courseId,
  obligation,
}: {
  apiOrigin: string;
  courseId: string;
  obligation: Course["obligations"][number];
}) {
  const [instructions, setInstructions] = useState("");
  const [ownWork, setOwnWork] = useState("");
  const [level, setLevel] = useState<"obligation" | "course">("obligation");
  const [pending, setPending] = useState<WriteRequest | null>(null);
  const [handingIn, setHandingIn] = useState(false);
  const write = useMutation({
    mutationFn: async (body: WriteRequest): Promise<Written> => {
      setPending(body);
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/artifacts",
        { body },
      );
      if (result.data)
        return {
          started: { kind: body.kind, artifactId: result.data.artifactId },
        };
      if (result.response.status === 409)
        return { refused: (result.error as { error: string }).error };
      throw new Error("Could not ask for that.");
    },
  });
  const refused =
    write.data && "refused" in write.data ? write.data.refused : null;
  const rule = useQuery({
    queryKey: [apiOrigin, "ai-use", obligation.id],
    enabled: refused === "ai_use_conditions",
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/obligations/{id}/ai-use",
        { params: { path: { id: obligation.id } }, signal },
      );
      if (!result.data) throw new Error("Could not load the rule.");
      return result.data;
    },
  });
  const answer = useMutation({
    mutationFn: async (value: "forbidden" | "conditional" | "allowed") => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/obligations/{id}/ai-use",
        { params: { path: { id: obligation.id } }, body: { level, value } },
      );
      if (!result.data) throw new Error("Could not record your answer.");
    },
    // With the rule known, the same request is asked again.
    onSuccess: () => pending && write.mutate(pending),
  });
  const from = { selection: { courseIds: [courseId], sourceIds: [] } };
  return (
    <article aria-label={obligation.title}>
      <h3>{obligation.title}</h3>
      <label>
        Instructions for a draft
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="primary"
        disabled={write.isPending}
        onClick={() =>
          write.mutate({
            kind: "draft",
            obligationId: obligation.id,
            instructions,
            from,
          })
        }
      >
        Draft
      </Button>
      <label>
        Your own work
        <textarea
          value={ownWork}
          onChange={(event) => setOwnWork(event.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        disabled={write.isPending || !ownWork.trim()}
        onClick={() =>
          write.mutate({
            kind: "critique",
            obligationId: obligation.id,
            of: { ownWork },
            from,
          })
        }
      >
        Critique my work
      </Button>
      {write.data && "started" in write.data && (
        <p>
          Being made.{" "}
          <Link href={`/study/artifacts/${write.data.started.artifactId}`}>
            Open the {writtenAs[write.data.started.kind]}
          </Link>
        </p>
      )}
      <Button type="button" variant="ghost" onClick={() => setHandingIn(true)}>
        Prepare the Handoff
      </Button>
      {handingIn && (
        <HandoffPanel apiOrigin={apiOrigin} obligationId={obligation.id} />
      )}
      {refused === "ai_use_unknown" && (
        <fieldset aria-label="Does your course allow AI for this?">
          <legend>Does your course allow AI for this?</legend>
          <label>
            <input
              type="radio"
              name={`level-${obligation.id}`}
              checked={level === "obligation"}
              onChange={() => setLevel("obligation")}
            />
            For this assignment
          </label>
          <label>
            <input
              type="radio"
              name={`level-${obligation.id}`}
              checked={level === "course"}
              onChange={() => setLevel("course")}
            />
            For the whole course
          </label>
          <Button type="button" onClick={() => answer.mutate("allowed")}>
            Allowed
          </Button>
          <Button type="button" onClick={() => answer.mutate("conditional")}>
            Allowed with conditions
          </Button>
          <Button type="button" onClick={() => answer.mutate("forbidden")}>
            Forbidden
          </Button>
        </fieldset>
      )}
      {refused === "ai_use_conditions" && rule.data && pending && (
        <section aria-label="Your course's conditions">
          <p>
            {rule.data.status !== "unknown" && rule.data.text
              ? rule.data.text
              : "You said your course allows AI under conditions."}
          </p>
          <Button
            type="button"
            onClick={() =>
              write.mutate({ ...pending, conditionsConfirmed: true })
            }
          >
            I will keep to these conditions
          </Button>
        </section>
      )}
      {refused === "ai_use_forbidden" && (
        <p role="alert">
          Your course does not allow AI for this, so nunio will not write it.
        </p>
      )}
      {(write.error ?? answer.error ?? rule.error) && (
        <p role="alert">
          {(write.error ?? answer.error ?? rule.error)!.message}
        </p>
      )}
    </article>
  );
}

function CourseSection({
  apiOrigin,
  course,
}: {
  apiOrigin: string;
  course: Course;
}) {
  const levels = useQuery(levelsQueries(apiOrigin, course.id));
  const topics = course.facts.filter(
    (fact) => fact.type === "topic" && fact.state !== "rejected",
  );
  return (
    <section aria-label={course.title}>
      <h2>{course.title}</h2>
      {levels.error && <p role="alert">{levels.error.message}</p>}
      {topics.map((topic) => (
        <TopicCard
          key={topic.id}
          apiOrigin={apiOrigin}
          courseId={course.id}
          topic={topic}
          level={levels.data?.find((l) => l.topicId === topic.id)}
        />
      ))}
      {course.obligations
        .filter((o) => o.state !== "rejected" && handedIn.includes(o.kind))
        .map((obligation) => (
          <ObligationCard
            key={obligation.id}
            apiOrigin={apiOrigin}
            courseId={course.id}
            obligation={obligation}
          />
        ))}
    </section>
  );
}

/** The student's Courses: each Topic's Understanding Level, practice on it, and their own Self-assessment. */
export function StudyScreen({ apiOrigin }: { apiOrigin: string }) {
  const courses = useQuery(coursesQueries(apiOrigin));
  return (
    <>
      <h1>Study</h1>
      {courses.error && <p role="alert">{courses.error.message}</p>}
      {courses.data?.map((course) => (
        <CourseSection key={course.id} apiOrigin={apiOrigin} course={course} />
      ))}
    </>
  );
}
