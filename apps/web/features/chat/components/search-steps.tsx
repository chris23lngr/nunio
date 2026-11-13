"use client";

import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@nunio/ui/components/trace/trace";
import { CircleAlert, LoaderCircle, Search } from "lucide-react";
import type { ChatUIMessage } from "../api/chat-queries";

type SearchPart = Extract<
  ChatUIMessage["parts"][number],
  { type: "tool-searchMaterial" }
>;

/** What a finished search found, in a few words. */
function found({ found, sources }: { found: number; sources: string[] }) {
  return found === 0
    ? "nichts gefunden"
    : `${found} Treffer in ${sources.join(", ")}`;
}

/** The searches nunio ran for an answer, one line each, from when they start until the answer is saved. */
export function SearchSteps({ searches }: { searches: SearchPart[] }) {
  return (
    <Trace>
      {searches.map((search) => {
        const status =
          search.state === "output-available"
            ? undefined
            : search.state === "output-error"
              ? "error"
              : "running";
        return (
          <div key={search.toolCallId}>
            <TraceLine status={status}>
              <TraceIcon>
                {status === "running" ? (
                  <LoaderCircle className="motion-safe:animate-spin" />
                ) : status === "error" ? (
                  <CircleAlert />
                ) : (
                  <Search />
                )}
              </TraceIcon>
              <TraceTitle>Durchsucht: „{search.input?.query ?? ""}“</TraceTitle>
              {search.state === "output-available" && (
                <TraceDescription>{found(search.output)}</TraceDescription>
              )}
            </TraceLine>
          </div>
        );
      })}
    </Trace>
  );
}
