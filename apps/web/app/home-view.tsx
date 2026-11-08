"use client";

import { createApiClient, type paths } from "@nunio/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Home = paths["/api/me/home"]["get"]["responses"][200]["content"]["application/json"];
type Attention = Home["attention"][number];
const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;
const unplanned: Record<Extract<Attention, { kind: "unplanned" }>["reason"], string> = {
  no_estimate: "needs an Estimate before it can be planned", no_deadline: "has no deadline, so it is not planned",
  past_due: "is past its deadline",
};

/** One tradeoff the student may choose; nunio never picks one silently. */
function tradeoff(item: Record<string, unknown>) {
  const kind = item.kind;
  if (kind === "exceed_daily_limit") return `Study beyond your daily limit (gains ${hours(Number(item.gainedMinutes))}, needs your Approval)`;
  if (kind === "free_time_from") return `Use time planned for lower-priority work (${hours(Number(item.gainedMinutes))})`;
  if (kind === "reduce_estimate") return `Plan ${hours(Number(item.byMinutes))} less for it`;
  return String(kind);
}

function Item({ item }: { item: Attention }) {
  if (item.kind === "shortfall") return <li>
    <strong>{item.title}</strong>{item.course && ` (${item.course})`} is {hours(item.shortMinutes)} short before{" "}
    {new Date(item.due).toLocaleString()}. Options:
    <ul>{item.tradeoffs.map((t, i) => <li key={i}>{tradeoff(t)}</li>)}</ul>
    <Link href="/plan">Open the Plan</Link>
  </li>;
  if (item.kind === "disagreement") return <li>
    A newer Source disagrees about <strong>{item.title}</strong> ({item.course}). <Link href="/review">Review it</Link>
  </li>;
  if (item.kind === "locked_conflict") return <li>A Locked Study Block now overlaps your calendar. <Link href="/plan">Open the Plan</Link></li>;
  return <li><strong>{item.title}</strong> {unplanned[item.reason]}. <Link href="/plan">Open the Plan</Link></li>;
}

/** The actionable day: what needs attention, what is ready, and what is still running. */
export function HomeView({ apiOrigin }: { apiOrigin: string }) {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await createApiClient(apiOrigin).GET("/api/me/home");
        if (cancelled) return;
        if (!result.data) return setError("Could not load your day.");
        setHome(result.data);
      } catch { if (!cancelled) setError("Could not load your day."); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [apiOrigin]);
  if (error) return <p role="alert">{error}</p>;
  if (!home) return <p>Loading your day…</p>;
  return (
    <>
      <section aria-labelledby="attention-title">
        <h1 id="attention-title">Needs your attention</h1>
        {home.attention.length ? <ul>{home.attention.map((item, i) => <Item key={i} item={item} />)}</ul> : <p>Nothing needs you right now.</p>}
      </section>
      <section aria-labelledby="ready-title">
        <h2 id="ready-title">Ready for you</h2>
        <p>Practice sets and other results nunio prepares will appear here.</p>
      </section>
      <section aria-labelledby="ongoing-title">
        <h2 id="ongoing-title">In progress</h2>
        {home.ongoing.length ? <ul>{home.ongoing.map(item => <li key={item.id}>
          {item.title}: {item.activity === "processing" ? "processing" : "reading for review"}</li>)}</ul> : <p>Nothing is running.</p>}
        <p>Work nunio does for you on its own will appear here too.</p>
      </section>
    </>
  );
}
