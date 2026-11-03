"use client";

import { createApiClient, type paths } from "@nunio/api-client";
import { useEffect, useState, type FormEvent } from "react";

type Course = paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
type Obligation = Course["obligations"][number];
type Fact = Course["facts"][number];
type Item = { kind: "obligation"; item: Obligation } | { kind: "fact"; item: Fact };
type Citation = Obligation["values"][number]["citations"][number];
const kinds: Record<Obligation["kind"], string> = {
  exam: "Exam", assignment: "Assignment", presentation: "Presentation", thesis: "Thesis", registration: "Registration", other: "Obligation",
};
const factTypes: Record<Fact["type"], string> = { topic: "Topic", course_rule: "Course rule", exam_logistics: "Exam logistics" };
const unsupported: Record<NonNullable<Obligation["unsupported"]>, string> = {
  source_deleted: "Its Source was deleted; your Correction is kept.",
  not_found: "Its Source no longer mentions it; your Correction is kept.",
};

function deadline({ date, time, timeZone }: Obligation["values"][number]["due"]) {
  return date ? [date, time, timeZone].filter(Boolean).join(" ") : "no date";
}
function due(value: Obligation["due"]) {
  return value.date || value.text === null ? deadline(value) : `No date found (“${value.text}”)`;
}
function Citations({ citations }: { citations: Citation[] }) {
  return <>{citations.map(citation => <blockquote key={citation.extractionId}>
    “{citation.quote}” <cite>{citation.title}, page {citation.page}</cite>
  </blockquote>)}</>;
}
const valueText = (value: Item["item"]["values"][number]) => "due" in value ? deadline(value.due) : value.value;
// Mirrors the server's comparison closely enough to pick out which values differ from a Correction.
const same = (a: string, b: string) => a.toLocaleLowerCase().replace(/\s+/g, " ").trim() === b.toLocaleLowerCase().replace(/\s+/g, " ").trim();
const label = ({ kind, item }: Item) => kind === "obligation" ? `${kinds[item.kind]}: ${item.title}` : `${factTypes[item.type]}: ${item.value}`;

export function ReviewList({ apiOrigin }: { apiOrigin: string }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
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

  async function act(request: () => Promise<{ data?: unknown; response: Response }>, invalid = "Could not save your decision. Please try again.") {
    setBusy(true); setError(null);
    try {
      const result = await request();
      if (!result.data) throw new Error(result.response.status === 400 ? "Check the date, time and time zone." : invalid);
      setEditing(null);
    } catch (error) { setError(error instanceof Error && error.message ? error.message : invalid); }
    finally { setBusy(false); setVersion(v => v + 1); }
  }
  const client = () => createApiClient(apiOrigin);
  const review = ({ kind, item }: Item, action: "confirm" | "reject" | "restore" | "keep_mine") =>
    act(() => client().POST("/api/me/review/{kind}/{id}/{action}", { params: { path: { kind, id: item.id, action } } }));
  const use = ({ kind, item }: Item, extractionId: string) =>
    act(() => client().POST("/api/me/review/{kind}/{id}/use", { params: { path: { kind, id: item.id } }, body: { extractionId } }));
  const decide = (id: string, decision: "accept" | "reject" | "restore") =>
    act(() => client().POST("/api/me/courses/{id}/decision", { params: { path: { id } }, body: { decision } }));
  function correct(event: FormEvent<HTMLFormElement>, { kind, item }: Item) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim() || null;
    const body = kind === "obligation"
      ? { title: field("title") ?? "", due: { date: field("date"), time: field("time"), timeZone: field("timeZone") }, destination: field("destination") }
      : { value: field("value") ?? "" };
    void act(() => client().POST("/api/me/review/{kind}/{id}/correct", { params: { path: { kind, id: item.id } }, body }));
  }

  // Render functions, not components: a component declared here would remount on every poll and drop what the student typed.
  function correctForm(entry: Item) {
    return <form onSubmit={event => correct(event, entry)}>
      {entry.kind === "obligation" ? <>
        <label>Title <input name="title" required defaultValue={entry.item.title} /></label>{" "}
        <label>Date <input name="date" type="date" defaultValue={entry.item.due.date ?? ""} /></label>{" "}
        <label>Time <input name="time" type="time" defaultValue={entry.item.due.time ?? ""} /></label>{" "}
        <label>Time zone <input name="timeZone" placeholder="Europe/Berlin" defaultValue={entry.item.due.timeZone ?? ""} /></label>{" "}
        <label>Hand-in <input name="destination" defaultValue={entry.item.destination ?? ""} /></label>
      </> : <label>Value <textarea name="value" required defaultValue={entry.item.value} /></label>}{" "}
      <button type="submit" disabled={busy}>Save Correction</button>{" "}
      <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
    </form>;
  }

  function itemView(entry: Item) {
    const { item } = entry;
    const corrected = item.provenance.kind === "correction";
    const live = item.values.filter(value => !value.overruled);
    // With a Correction, only values that differ from it are in question; without one, every live value is.
    const contested = corrected
      ? live.filter(value => !same(valueText(value), entry.kind === "obligation" ? deadline(entry.item.due) : entry.item.value)) : live;
    const citations = item.values.flatMap(value => value.citations);
    return <li key={item.id}>
      <p><strong>{label(entry)}</strong>{entry.kind === "obligation" && <> — due {due(entry.item.due)}</>}{corrected && " (your Correction)"}</p>
      {entry.kind === "obligation" && entry.item.destination && <p>Hand-in (not verified): {entry.item.destination}</p>}
      {item.uncertainty && <p>Uncertain: {item.uncertainty}</p>}
      {item.unsupported && <p>{unsupported[item.unsupported]}</p>}
      {item.disagreement ? <div role="group" aria-label="Disagreement">
        <p>{corrected ? "A Source now says something different from your Correction:" : "Your Sources disagree:"}</p>
        <ul>{contested.map(value => <li key={value.citations[0]!.extractionId}>
          {valueText(value)}{" "}
          <button type="button" disabled={busy} onClick={() => { void use(entry, value.citations[0]!.extractionId); }}>Use this</button>
          <Citations citations={value.citations} />
        </li>)}</ul>
        {corrected && <button type="button" disabled={busy} onClick={() => { void review(entry, "keep_mine"); }}>Keep mine</button>}
      </div> : citations.length > 0 && <>
        <Citations citations={citations.slice(0, 1)} />
        {citations.length > 1 && <details><summary>Also in {citations.length - 1} more</summary><Citations citations={citations.slice(1)} /></details>}
      </>}
      {editing === item.id ? correctForm(entry) : <p>
        {item.state === "confirmed" ? <span>Confirmed</span> : !item.disagreement
          && <button type="button" disabled={busy} onClick={() => { void review(entry, "confirm"); }}>Confirm</button>}{" "}
        <button type="button" disabled={busy} onClick={() => setEditing(item.id)}>Correct</button>{" "}
        <button type="button" disabled={busy} onClick={() => { void review(entry, "reject"); }}>Reject</button>
      </p>}
    </li>;
  }

  const items = (course: Course) => {
    const entries: Item[] = [...course.obligations.map(item => ({ kind: "obligation" as const, item })),
      ...course.facts.map(item => ({ kind: "fact" as const, item }))];
    const shown = entries.filter(entry => entry.item.state !== "rejected"), rejected = entries.filter(entry => entry.item.state === "rejected");
    const obligations = shown.filter(entry => entry.kind === "obligation"), facts = shown.filter(entry => entry.kind === "fact");
    return <>
      <h3>Obligations</h3>
      {obligations.length === 0 ? <p>None found.</p> : <ul>{obligations.map(itemView)}</ul>}
      {facts.length > 0 && <><h3>Topics and details</h3><ul>{facts.map(itemView)}</ul></>}
      {rejected.length > 0 && <details>
        <summary>Rejected ({rejected.length})</summary>
        <ul>{rejected.map(entry => <li key={entry.item.id}>
          {label(entry)}{" "}
          <button type="button" disabled={busy} onClick={() => { void review(entry, "restore"); }}>Restore</button>
        </li>)}</ul>
      </details>}
    </>;
  };
  const open = (courses ?? []).filter(course => course.status !== "rejected");
  const rejectedCourses = (courses ?? []).filter(course => course.status === "rejected");

  return (
    <section aria-labelledby="review-title">
      <h1 id="review-title">Review</h1>
      <p>Check what nunio found in your Sources. Each item shows the passage it came from.</p>
      {error && <p role="alert">{error}</p>}
      {courses === null ? <p>Loading…</p> : courses.length === 0 ? <p>Nothing to review yet. Results appear here once a Source has been read.</p>
        : open.map(course => <article key={course.id} aria-labelledby={`course-${course.id}`}>
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
      {rejectedCourses.length > 0 && <details>
        <summary>Rejected Courses ({rejectedCourses.length})</summary>
        <ul>{rejectedCourses.map(course => <li key={course.id}>
          {course.code ? `${course.code} ` : ""}{course.title}{" "}
          <button type="button" disabled={busy} onClick={() => { void decide(course.id, "restore"); }}>Restore</button>
        </li>)}</ul>
      </details>}
    </section>
  );
}
