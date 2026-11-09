"use client";

import type { paths } from "@nunio/api-client";
import { createApiClient } from "@nunio/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  hours,
  overlapReasons,
  tradeoffText,
  unplannedReasons,
} from "./plan-wording";

type Home =
  paths["/api/me/home"]["get"]["responses"][200]["content"]["application/json"];
type Attention = Home["attention"][number];

function Item({ item }: { item: Attention }) {
  if (item.kind === "shortfall")
    return (
      <li>
        <strong>{item.title}</strong>
        {item.course && ` (${item.course})`} is {hours(item.shortMinutes)} short
        before {new Date(item.due).toLocaleString()}.
        {item.unreviewed &&
          " It is not reviewed yet, so check its deadline and Estimate."}{" "}
        Options:
        <ul>
          {item.tradeoffs.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Tradeoffs have no id and the list is replaced, never reordered.
            <li key={i}>{tradeoffText(t)}</li>
          ))}
        </ul>
        <Link href="/plan">Open the Plan</Link>
      </li>
    );
  if (item.kind === "disagreement")
    return (
      <li>
        A newer Source disagrees about <strong>{item.title}</strong> (
        {item.course}). <Link href="/review">Review it</Link>
      </li>
    );
  if (item.kind === "overlap")
    return (
      <li>
        A Study Block for <strong>{item.title}</strong> now overlaps your
        calendar and {overlapReasons[item.reason]}.{" "}
        <Link href="/plan">Open the Plan</Link>
      </li>
    );
  return (
    <li>
      <strong>{item.title}</strong> {unplannedReasons[item.reason]}.{" "}
      <Link href="/plan">Open the Plan</Link>
    </li>
  );
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
      } catch {
        if (!cancelled) setError("Could not load your day.");
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiOrigin]);
  if (error) return <p role="alert">{error}</p>;
  if (!home) return <p>Loading your day…</p>;
  return (
    <>
      <section aria-labelledby="attention-title">
        <h1 id="attention-title">Needs your attention</h1>
        {home.attention.length ? (
          <ul>
            {home.attention.map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Attention items have no id and the list is replaced, never reordered.
              <Item key={i} item={item} />
            ))}
          </ul>
        ) : (
          <p>Nothing needs you right now.</p>
        )}
      </section>
      <section aria-labelledby="ready-title">
        <h2 id="ready-title">Ready for you</h2>
        <p>Practice sets and other results nunio prepares will appear here.</p>
      </section>
      <section aria-labelledby="ongoing-title">
        <h2 id="ongoing-title">In progress</h2>
        {home.ongoing.length ? (
          <ul>
            {home.ongoing.map((item) => (
              <li key={item.id}>
                {item.title}:{" "}
                {item.activity === "processing"
                  ? "processing"
                  : "reading for review"}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing is running.</p>
        )}
        <p>Work nunio does for you on its own will appear here too.</p>
      </section>
    </>
  );
}
