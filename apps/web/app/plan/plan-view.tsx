"use client";

import { createApiClient, type paths } from "@nunio/api-client";
import { useEffect, useState, type FormEvent } from "react";
import { hours, overlapReasons, tradeoffText, unplannedReasons } from "../plan-wording";

type Plan = paths["/api/me/plan"]["get"]["responses"][200]["content"]["application/json"];
type Move = Plan["proposal"]["moves"][number];
type Project = paths["/api/me/projects"]["get"]["responses"][200]["content"]["application/json"][number];
type Ranked = { kind: "course" | "project" | "obligation"; id: string; name: string };
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const when = (value: string | null) => !value ? "" : new Date(value).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minuteOf = (value: string) => { const [h, m] = value.split(":").map(Number); return h! * 60 + m!; };

/** The student's Plan, the proposal nunio would make now, and the Limits it plans within. */
export function PlanView({ apiOrigin }: { apiOrigin: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = createApiClient(apiOrigin);
        const [result, listed] = await Promise.all([client.GET("/api/me/plan"), client.GET("/api/me/projects")]);
        if (cancelled) return;
        if (!result.data || !listed.data) return setError("Could not load your Plan.");
        setPlan(result.data);
        setProjects(listed.data);
      } catch { if (!cancelled) setError("Could not load your Plan."); }
    })();
    return () => { cancelled = true; };
  }, [apiOrigin, version]);

  /** Runs one change, then reloads; a refusal shows `failure`. */
  async function act(request: () => Promise<{ response: Response }>, failure: string) {
    setBusy(true); setError(null);
    try {
      const { response } = await request();
      if (!response.ok) throw new Error(response.status === 409 ? "The Plan changed meanwhile; here is a fresh proposal." : failure);
    } catch (error) { setError(error instanceof Error && error.message ? error.message : failure); }
    finally { setBusy(false); setVersion(v => v + 1); }
  }
  const client = () => createApiClient(apiOrigin);
  const titleOf = (workId: string) => plan?.obligations.find(o => o.id === workId)?.title ?? plan?.tasks.find(t => t.id === workId)?.title ?? "Work";
  const apply = (move: Move) => {
    if (move.needsApproval && !window.confirm(`Move your block for ${titleOf(move.workId)}? You placed it yourself.`)) return;
    void act(() => client().POST("/api/me/plan/apply", { body: move }), "Could not apply this move.");
  };
  const form = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); event.currentTarget.reset(); return data; };

  if (!plan) return error ? <p role="alert">{error}</p> : <p>Loading your Plan…</p>;
  const { proposal, limits } = plan;
  const rankable: Ranked[] = [
    ...[...new Map(plan.obligations.map(o => [o.courseId, o.course])).entries()].map(([id, name]) => ({ kind: "course" as const, id, name: `Course: ${name}` })),
    ...projects.map(project => ({ kind: "project" as const, id: project.id, name: `Project: ${project.name}` })),
    ...plan.obligations.map(o => ({ kind: "obligation" as const, id: o.id, name: `${o.title} (${o.course})` })),
  ];
  return (
    <>
      <h1>Plan</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-labelledby="proposal-title">
        <h2 id="proposal-title">What nunio proposes</h2>
        {proposal.moves.length ? <ul>{proposal.moves.map((move, i) => <li key={i}>
          {move.kind === "create" ? `Study ${titleOf(move.workId)}: ${when(move.start)} – ${when(move.end)}`
            : `Move your block for ${titleOf(move.workId)} to ${when(move.to.start)}`}
          {move.needsApproval && " (your block: needs your confirmation)"}{" "}
          <button type="button" disabled={busy} onClick={() => apply(move)}>Apply</button>
        </li>)}</ul> : <p>Your Plan already covers everything nunio can plan.</p>}
        {proposal.shortfalls.map(s => <div key={s.workId} role="status">
          {titleOf(s.workId)} is {hours(s.shortMinutes)} short before {when(s.due)}. Options:
          <ul>{s.tradeoffs.map((t, i) => <li key={i}>{tradeoffText(t)}</li>)}</ul>
        </div>)}
        {proposal.unplanned.map(u => <p key={u.workId}>{titleOf(u.workId)} {unplannedReasons[u.reason]}.</p>)}
        {proposal.overlaps.map(o => <p key={o.blockId}>A Study Block for {titleOf(plan.studyBlocks.find(b => b.id === o.blockId)?.work.id ?? "")}{" "}
          now overlaps your calendar and {overlapReasons[o.reason]}.</p>)}
      </section>

      <section aria-labelledby="obligations-title">
        <h2 id="obligations-title">Obligations and Estimates</h2>
        <button type="button" disabled={busy} onClick={() => { void act(() => client().POST("/api/me/plan/estimates"), "Could not propose Estimates."); }}>
          Let nunio propose missing Estimates
        </button>
        <ul>{plan.obligations.map(o => <li key={o.id}>
          {o.title} ({o.course}){o.due && `, due ${when(o.due)}`}{o.state === "unreviewed" && " (not reviewed yet)"}:{" "}
          {o.estimate ? `${o.estimate.minutes / 60} h ${o.estimate.estimatedBy === "nunio" ? `proposed by nunio (${o.estimate.rationale})` : "your Estimate"}` : "no Estimate"}
          <form onSubmit={event => { const hours = Number(form(event).get("hours"));
            void act(() => client().PUT("/api/me/estimates/{kind}/{id}", { params: { path: { kind: "obligation", id: o.id } },
              body: { minutes: Math.round(hours * 60) } }), "Enter a positive number of hours."); }}>
            <label>Hours <input name="hours" type="number" min="0.5" step="0.5" required disabled={busy} /></label>
            <button type="submit" disabled={busy}>Correct</button>
          </form>
        </li>)}</ul>
      </section>

      <section aria-labelledby="tasks-title">
        <h2 id="tasks-title">Tasks</h2>
        <form onSubmit={event => { const data = form(event); const obligationId = String(data.get("obligation") ?? "");
          void act(() => client().POST("/api/me/tasks", { body: { title: String(data.get("title")), obligationId: obligationId || null } }), "Could not add the Task."); }}>
          <label>Task <input name="title" required maxLength={500} disabled={busy} /></label>
          <label>For <select name="obligation" disabled={busy}><option value="">No Obligation</option>
            {plan.obligations.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
          <button type="submit" disabled={busy}>Add</button>
        </form>
        <ul>{plan.tasks.map(t => <li key={t.id}>
          <label><input type="checkbox" checked={t.done} disabled={busy} onChange={event => {
            void act(() => client().POST("/api/me/tasks/{id}/done", { params: { path: { id: t.id } }, body: { done: event.target.checked } }), "Could not save.");
          }} /> {t.title}</label>{t.estimate && ` (${hours(t.estimate.minutes)}${t.estimate.estimatedBy === "nunio" ? ", proposed by nunio" : ""})`}
          <form onSubmit={event => { const value = String(form(event).get("max") ?? "");
            void act(() => client().PUT("/api/me/tasks/{id}/limit", { params: { path: { id: t.id } },
              body: { maxMinutesPerDay: value ? Math.round(Number(value) * 60) : null } }), "The limit must be at least half an hour."); }}>
            <label>At most <input name="max" type="number" min="0.5" step="0.5" defaultValue={t.maxMinutesPerDay ? t.maxMinutesPerDay / 60 : ""} /> h a day</label>
            <button type="submit" disabled={busy}>Save</button>
          </form>
        </li>)}</ul>
      </section>

      <section aria-labelledby="blocks-title">
        <h2 id="blocks-title">Study Blocks</h2>
        <ul>{plan.studyBlocks.map(b => <li key={b.id}>
          {titleOf(b.work.id)}: {when(b.start)} – {when(b.end)} ({b.placedBy === "nunio" ? "placed by nunio" : "yours"}{b.locked && ", Locked"}){" "}
          <button type="button" disabled={busy} onClick={() => { void act(() => client().POST("/api/me/study-blocks/{id}/lock",
            { params: { path: { id: b.id } }, body: { locked: !b.locked } }), "Could not save."); }}>{b.locked ? "Unlock" : "Lock"}</button>{" "}
          <button type="button" disabled={busy} onClick={() => { void act(() => client().DELETE("/api/me/study-blocks/{id}",
            { params: { path: { id: b.id } } }), "Could not delete."); }}>Delete</button>
        </li>)}</ul>
      </section>

      <section aria-labelledby="limits-title">
        <h2 id="limits-title">Limits</h2>
        <form onSubmit={event => { const data = form(event);
          void act(() => client().PUT("/api/me/preferences", { body: { studyFromMinute: minuteOf(String(data.get("from"))),
            studyToMinute: minuteOf(String(data.get("to"))), maxMinutesPerDay: Math.round(Number(data.get("max")) * 60) } }),
            "The study window must end after it starts, and the daily limit be at least half an hour."); }}>
          <label>Study from <input name="from" type="time" defaultValue={clock(limits.preferences.studyFromMinute)} required /></label>
          <label>until <input name="to" type="time" defaultValue={clock(limits.preferences.studyToMinute)} required /></label>
          <label>At most <input name="max" type="number" min="0.5" step="0.5" defaultValue={limits.preferences.maxMinutesPerDay / 60} required /> h a day</label>
          <button type="submit" disabled={busy}>Save</button>
        </form>
        <h3>Per Course</h3>
        <p>A Course&apos;s own daily limit; a Task&apos;s own limit wins over it.</p>
        {[...new Map(plan.obligations.map(o => [o.courseId, o.course])).entries()].map(([courseId, name]) =>
          <form key={courseId} onSubmit={event => { const value = String(form(event).get("max") ?? "");
            void act(() => client().PUT("/api/me/courses/{id}/limit", { params: { path: { id: courseId } },
              body: { maxMinutesPerDay: value ? Math.round(Number(value) * 60) : null } }), "The limit must be at least half an hour."); }}>
            <label>{name}: at most <input name="max" type="number" min="0.5" step="0.5"
              defaultValue={(limits.courses.find(c => c.courseId === courseId)?.maxMinutesPerDay ?? 0) / 60 || ""} /> h a day</label>
            <button type="submit" disabled={busy}>Save</button>
          </form>)}
        <h3>Protected Time</h3>
        <p>nunio never plans into this time, even when a deadline is at risk.</p>
        <ul>{limits.protectedTime.map(t => <li key={t.id}>
          {"weekday" in t ? `Every ${weekdays[t.weekday - 1]} ${clock(t.fromMinute)}–${clock(t.toMinute)}` : `${when(t.start)} – ${when(t.end)}`}{" "}
          <button type="button" disabled={busy} onClick={() => { void act(() => client().DELETE("/api/me/protected-time/{id}",
            { params: { path: { id: t.id } } }), "Could not remove."); }}>Remove</button></li>)}</ul>
        <form onSubmit={event => { const data = form(event);
          void act(() => client().POST("/api/me/protected-time", { body: { weekday: Number(data.get("weekday")),
            fromMinute: minuteOf(String(data.get("from"))), toMinute: minuteOf(String(data.get("to"))) || 1440 } }), "The time must end after it starts."); }}>
          <label>Every <select name="weekday">{weekdays.map((day, i) => <option key={day} value={i + 1}>{day}</option>)}</select></label>
          <label>from <input name="from" type="time" required /></label>
          <label>until <input name="to" type="time" required /></label>
          <button type="submit" disabled={busy}>Protect</button>
        </form>
        <form onSubmit={event => { const data = form(event);
          void act(() => client().POST("/api/me/protected-time", { body: { start: new Date(String(data.get("start"))).toISOString(),
            end: new Date(String(data.get("end"))).toISOString() } }), "The time must end after it starts, within a year."); }}>
          <label>Once, from <input name="start" type="datetime-local" required /></label>
          <label>until <input name="end" type="datetime-local" required /></label>
          <button type="submit" disabled={busy}>Protect</button>
        </form>
      </section>

      <section aria-labelledby="events-title">
        <h2 id="events-title">Fixed Events</h2>
        <p>Lectures, shifts and other events nunio plans around and never changes.</p>
        <form onSubmit={event => { const data = form(event);
          void act(() => client().POST("/api/me/fixed-events", { body: { title: String(data.get("title")),
            start: new Date(String(data.get("start"))).toISOString(), end: new Date(String(data.get("end"))).toISOString() } }), "The event must end after it starts."); }}>
          <label>Event <input name="title" required maxLength={500} /></label>
          <label>from <input name="start" type="datetime-local" required /></label>
          <label>until <input name="end" type="datetime-local" required /></label>
          <button type="submit" disabled={busy}>Add</button>
        </form>
        <form onSubmit={event => { event.preventDefault(); const input = event.currentTarget;
          const file = new FormData(input).get("calendar");
          if (!(file instanceof File) || file.size < 1 || file.size > 1024 * 1024) return setError("Choose a calendar file (.ics) up to 1 MB.");
          void act(async () => { const ics = await file.text(); input.reset();
            return client().POST("/api/me/calendar-sources", { body: { name: file.name, ics } }); }, "This calendar file could not be read."); }}>
          <label>Calendar file <input name="calendar" type="file" accept=".ics,text/calendar" required /></label>
          <button type="submit" disabled={busy}>Add calendar</button>
        </form>
        <ul>{plan.calendars.map(c => <li key={c.id}>{c.name}: {c.events} events{" "}
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete ${c.name}? Its events are removed from your Plan.`))
            void act(() => client().DELETE("/api/me/calendar-sources/{id}", { params: { path: { id: c.id } } }), "Could not delete."); }}>Delete</button></li>)}</ul>
        <ul>{plan.fixedEvents.filter(e => !e.calendarId).map(e => <li key={e.id}>{e.title}: {when(e.start)} – {when(e.end)}{" "}
          <button type="button" disabled={busy} onClick={() => { void act(() => client().DELETE("/api/me/fixed-events/{id}",
            { params: { path: { id: e.id } } }), "Could not remove."); }}>Remove</button></li>)}</ul>
      </section>

      <section aria-labelledby="priorities-title">
        <h2 id="priorities-title">Priorities</h2>
        <p>Rank what matters most, 1 first. An Obligation&apos;s own rank wins over its Project&apos;s, and a Project&apos;s over its Course&apos;s.
          When there is not enough time, nunio suggests giving up time from lower-ranked work first.</p>
        <form onSubmit={event => { const data = form(event);
          const items = rankable.map(entry => ({ entry, rank: Number(data.get(`${entry.kind}:${entry.id}`)) }))
            .filter(r => r.rank > 0).sort((a, b) => a.rank - b.rank).map(({ entry: { kind, id } }) => ({ kind, id }));
          void act(() => client().PUT("/api/me/priorities", { body: { items } }), "Could not save Priorities."); }}>
          {rankable.map(entry => <label key={`${entry.kind}:${entry.id}`}>{entry.name} rank{" "}
            <input name={`${entry.kind}:${entry.id}`} type="number" min="1" step="1"
              defaultValue={plan.priorities.findIndex(r => r.kind === entry.kind && r.id === entry.id) + 1 || ""} /></label>)}
          <button type="submit" disabled={busy}>Save</button>
        </form>
      </section>
    </>
  );
}
