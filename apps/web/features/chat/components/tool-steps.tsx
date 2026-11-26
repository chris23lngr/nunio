"use client";

import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@nunio/ui/components/trace/trace";
import {
  Blocks,
  BookOpen,
  CalendarDays,
  CircleAlert,
  LoaderCircle,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
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

/**
 * The Integration and tool label of a read through a Connection: from its saved output, or while it streams from the
 * tool's metadata, which the model never sees.
 */
function integrationRead(
  part: ToolPart,
): { integration: string; label: string } | undefined {
  if (part.type === "tool-integration")
    return part.state === "output-available"
      ? {
          integration: part.output.integration.name,
          label: part.output.tool.label,
        }
      : undefined;
  const metadata = (
    part as { toolMetadata?: { integration?: unknown; label?: unknown } }
  ).toolMetadata;
  return typeof metadata?.integration === "string" &&
    typeof metadata.label === "string"
    ? { integration: metadata.integration, label: metadata.label }
    : undefined;
}

/** One step line: a single tool call, or every read through one Integration with its per-tool counts. */
type Step = {
  key: string;
  parts: ToolPart[];
  icon: ReactNode;
  title: string;
  result?: string;
};

/** The answer's steps in order; an Integration's reads join into one line where its first read is. */
function stepsOf(parts: ToolPart[]): Step[] {
  const steps: Step[] = [];
  const reads = new Map<string, { step: Step; counts: Map<string, number> }>();
  for (const part of parts) {
    const read = integrationRead(part);
    if (read) {
      let group = reads.get(read.integration);
      if (!group) {
        group = {
          step: {
            key: part.toolCallId,
            parts: [],
            icon: <Blocks />,
            title: "",
          },
          counts: new Map(),
        };
        reads.set(read.integration, group);
        steps.push(group.step);
      }
      group.step.parts.push(part);
      group.counts.set(read.label, (group.counts.get(read.label) ?? 0) + 1);
      group.step.title = [
        read.integration,
        ...[...group.counts].map(([label, n]) => `${label} ${n}×`),
      ].join(" · ");
      continue;
    }
    const step = describe(part);
    if (step) steps.push({ key: part.toolCallId, parts: [part], ...step });
  }
  return steps;
}

/** What nunio read for an answer, one line per step, from when it starts until the answer is saved. */
export function ToolSteps({ parts }: { parts: ToolPart[] }) {
  return (
    <Trace>
      {stepsOf(parts).map((step) => {
        const status = step.parts.every(
          (part) => part.state === "output-available",
        )
          ? undefined
          : step.parts.some((part) => part.state === "output-error")
            ? "error"
            : "running";
        return (
          <div key={step.key}>
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
