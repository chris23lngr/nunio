"use client";

import type { paths } from "@nunio/api-client";
import { createApiClient } from "@nunio/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { nameOf } from "@/features/responsibilities/name";
import {
  hours,
  overlapReasons,
  tradeoffText,
  unplannedReasons,
} from "./plan-wording";

type Home =
  paths["/api/me/home"]["get"]["responses"][200]["content"]["application/json"];
type Attention = Home["attention"][number];

function Item({
  item,
  onSkip,
}: {
  item: Attention;
  /** Skips a Routine until a deadline, as a Shortfall's tradeoff offers (ADR-0022). */
  onSkip: (routine: string, until: string) => void;
}) {
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
            <li key={i}>
              {tradeoffText(t)}
              {t.kind === "skip_routine" && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => onSkip(t.routine, String(t.until))}
                  >
                    Routine aussetzen
                  </button>
                </>
              )}
            </li>
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
const artifactNames = {
  practice_set: "Practice set",
  flashcards: "Flashcards",
  draft: "Draft",
  critique: "Critique",
};

export function HomeView({ apiOrigin }: { apiOrigin: string }) {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const skip = async (routine: string, until: string) => {
    try {
      const { response } = await createApiClient(apiOrigin).POST(
        "/api/me/event-series/{id}/routine/skip",
        { params: { path: { id: routine } }, body: { until } },
      );
      if (!response.ok) throw new Error();
    } catch {
      setError("Could not skip the Routine.");
    } finally {
      setVersion((v) => v + 1);
    }
  };
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
  }, [apiOrigin, version]);
  if (error) return <p role="alert">{error}</p>;
  if (!home) return <p>Loading your day…</p>;
  return (
    <>
      <section aria-labelledby="attention-title">
        <h1 id="attention-title">Needs your attention</h1>
        {home.attention.length ? (
          <ul>
            {home.attention.map((item, i) => (
              <Item
                // biome-ignore lint/suspicious/noArrayIndexKey: Attention items have no id and the list is replaced, never reordered.
                key={i}
                item={item}
                onSkip={(routine, until) => {
                  void skip(routine, until);
                }}
              />
            ))}
          </ul>
        ) : (
          <p>Nothing needs you right now.</p>
        )}
      </section>
      <section aria-labelledby="ready-title">
        <h2 id="ready-title">Ready for you</h2>
        {home.artifacts.length ? (
          <ul>
            {home.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <Link href={`/study/artifacts/${artifact.id}`}>
                  {artifactNames[artifact.kind]}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing new from nunio yet.</p>
        )}
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
        <h3>Delegated to nunio</h3>
        {home.agentWork.length ? (
          <ul>
            {home.agentWork.map((item) =>
              item.kind === "approval" ? (
                <li key={item.actionId}>
                  {item.title}: waiting for your Approval above
                </li>
              ) : (
                <li key={item.id}>
                  <Link href={`/responsibilities/${item.id}`}>
                    {nameOf({
                      course: item.course ? { title: item.course } : null,
                      exam: item.exam ? { title: item.exam } : null,
                    })}
                  </Link>{" "}
                  ({item.state})
                </li>
              ),
            )}
          </ul>
        ) : (
          <p>
            Nothing yet. <Link href="/responsibilities">Delegate a Course</Link>{" "}
            and nunio keeps its Study Blocks planned.
          </p>
        )}
      </section>
    </>
  );
}
