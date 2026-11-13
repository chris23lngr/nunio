"use client";

import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@nunio/ui/components/trace/trace";
import {
  BookOpen,
  CalendarDays,
  CircleAlert,
  LoaderCircle,
  Search,
} from "lucide-react";
import type { ChatUIMessage } from "../api/chat-queries";

export type ToolPart = Extract<
  ChatUIMessage["parts"][number],
  { type: `tool-${string}` }
>;

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;
/** A YYYY-MM-DD date as day and month, such as "16.11.". */
const day = (date: string | undefined) =>
  date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.` : "";

/** What a step shows: what nunio read, and once it has, how much it found. */
function describe(part: ToolPart) {
  const done = part.state === "output-available";
  switch (part.type) {
    case "tool-searchMaterial":
      return {
        icon: <Search />,
        title: `Durchsucht: „${part.input?.query ?? ""}“`,
        result: done
          ? part.output.found === 0
            ? "nichts gefunden"
            : `${part.output.found} Treffer in ${part.output.sources.join(", ")}`
          : undefined,
      };
    case "tool-agenda":
      return {
        icon: <CalendarDays />,
        title: `Plan gelesen: ${day(part.input?.from)}–${day(part.input?.to)}`,
        result: done
          ? [
              count(part.output.obligations, "Frist", "Fristen"),
              count(part.output.studyBlocks, "Lernblock", "Lernblöcke"),
              count(part.output.fixedEvents, "Termin", "Termine"),
            ].join(", ")
          : undefined,
      };
    case "tool-courseFacts":
      return {
        icon: <BookOpen />,
        title: done
          ? `Kursinfos gelesen: ${part.output.course}`
          : "Liest Kursinfos …",
        result: done
          ? count(part.output.facts, "Eintrag", "Einträge")
          : undefined,
      };
    case "tool-startPracticeSet":
    case "tool-startFlashcards":
      return {
        icon: <BookOpen />,
        title:
          part.type === "tool-startPracticeSet"
            ? "Practice Set gestartet"
            : "Flashcards gestartet",
        result: done ? count(part.output.topics, "Topic", "Topics") : undefined,
      };
    default:
      return undefined;
  }
}

/** What nunio read for an answer, one line per step, from when it starts until the answer is saved. */
export function ToolSteps({ parts }: { parts: ToolPart[] }) {
  return (
    <Trace>
      {parts.map((part) => {
        const step = describe(part);
        if (!step) return null;
        const status =
          part.state === "output-available"
            ? undefined
            : part.state === "output-error"
              ? "error"
              : "running";
        return (
          <div key={part.toolCallId}>
            <TraceLine status={status}>
              <TraceIcon>
                {status === "running" ? (
                  <LoaderCircle className="motion-safe:animate-spin" />
                ) : status === "error" ? (
                  <CircleAlert />
                ) : (
                  step.icon
                )}
              </TraceIcon>
              <TraceTitle>{step.title}</TraceTitle>
              {step.result && (
                <TraceDescription>{step.result}</TraceDescription>
              )}
            </TraceLine>
          </div>
        );
      })}
    </Trace>
  );
}
