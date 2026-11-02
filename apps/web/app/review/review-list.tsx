"use client";

import { createApiClient, type paths } from "@nunio/api-client";
import { useEffect, useState } from "react";

type Course = paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
type Obligation = Course["obligations"][number];
type Fact = Course["facts"][number];
const kinds: Record<Obligation["kind"], string> = {
  exam: "Exam", assignment: "Assignment", presentation: "Presentation", thesis: "Thesis", registration: "Registration", other: "Obligation",
};
const factTypes: Record<Fact["type"], string> = { topic: "Topic", course_rule: "Course rule", exam_logistics: "Exam logistics" };

function due({ date, time, timeZone, text }: Obligation["due"]) {
  if (!date) return `No date found (“${text}”)`;
  return [date, time, timeZone].filter(Boolean).join(" ");
}
function Passage({ provenance }: { provenance: Obligation["provenance"] }) {
  return <blockquote>“{provenance.quote}” <cite>{provenance.title}, page {provenance.page}</cite></blockquote>;
}

export function ReviewList({ apiOrigin }: { apiOrigin: string }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await createApiClient(apiOrigin).GET("/api/me/review");
        if (cancelled) return;
        if (!result.data) return setError("Could not load your review.");
        setCourses(result.data.courses);
      } catch { if (!cancelled) setError("Could not load your review."); }
    };
    void load();
    // New extractions arrive while the student reviews.
    const timer = setInterval(() => { void load(); }, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [apiOrigin, version]);

  async function act(request: () => Promise<{ data?: unknown }>) {
    setBusy(true); setError(null);
    try {
      if (!(await request()).data) throw new Error();
    } catch { setError("Could not save your decision. Please try again."); }
    finally { setBusy(false); setVersion(v => v + 1); }
  }
  const client = () => createApiClient(apiOrigin);
  const review = (kind: "obligation" | "fact", id: string, action: "confirm" | "reject") =>
    act(() => client().POST("/api/me/review/{kind}/{id}/{action}", { params: { path: { kind, id, action } } }));
  const decide = (id: string, decision: "accept" | "reject") =>
    act(() => client().POST("/api/me/courses/{id}/decision", { params: { path: { id } }, body: { decision } }));
  const actions = (kind: "obligation" | "fact", item: Obligation | Fact) => item.state === "confirmed" ? <span>Confirmed</span> : <>
    <button type="button" disabled={busy} onClick={() => { void review(kind, item.id, "confirm"); }}>Confirm</button>{" "}
    <button type="button" disabled={busy} onClick={() => { void review(kind, item.id, "reject"); }}>Reject</button>
  </>;
  const items = (course: Course) => <>
    <h3>Obligations</h3>
    {course.obligations.length === 0 ? <p>None found.</p> : <ul>{course.obligations.map(item => <li key={item.id}>
      <p><strong>{kinds[item.kind]}: {item.title}</strong> — due {due(item.due)}</p>
      {item.destination && <p>Hand-in (as stated, not verified): {item.destination}</p>}
      {item.uncertainty && <p>Uncertain: {item.uncertainty}</p>}
      <Passage provenance={item.provenance} />
      {actions("obligation", item)}
    </li>)}</ul>}
    {course.facts.length > 0 && <>
      <h3>Topics and details</h3>
      <ul>{course.facts.map(item => <li key={item.id}>
        <p><strong>{factTypes[item.type]}:</strong> {item.value}</p>
        {item.uncertainty && <p>Uncertain: {item.uncertainty}</p>}
        <Passage provenance={item.provenance} />
        {actions("fact", item)}
      </li>)}</ul>
    </>}
  </>;

  return (
    <section aria-labelledby="review-title">
      <h1 id="review-title">Review</h1>
      <p>Check what nunio found in your Sources. Each item shows the passage it came from.</p>
      {error && <p role="alert">{error}</p>}
      {courses === null ? <p>Loading…</p> : courses.length === 0 ? <p>Nothing to review yet. Results appear here once a Source has been read.</p>
        : courses.map(course => <article key={course.id} aria-labelledby={`course-${course.id}`}>
          <h2 id={`course-${course.id}`}>{course.code ? `${course.code} ` : ""}{course.title}</h2>
          {course.status === "proposed" ? <>
            <p>
              Is this one of your Courses?{" "}
              <button type="button" disabled={busy} onClick={() => { void decide(course.id, "accept"); }}>Yes, accept</button>{" "}
              <button type="button" disabled={busy} onClick={() => { void decide(course.id, "reject"); }}>No, reject</button>
            </p>
            {/* A module handbook proposes many Courses; their items stay folded until the student accepts one. */}
            <details>
              <summary>{course.obligations.length + course.facts.length} items found</summary>
              {items(course)}
            </details>
          </> : <><p>Accepted Course</p>{items(course)}</>}
        </article>)}
    </section>
  );
}
