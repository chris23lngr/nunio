"use client";

import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import { Citation } from "@nunio/ui/components/citation/citation";
import { Textarea } from "@nunio/ui/components/textarea/textarea";
import { BadgeCheck, CircleAlert, OctagonX, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sourceReferences } from "@/features/shared/components/source-citations";
import type { Attempt } from "../api/study-queries";

type Item = {
  id: string;
  question: string;
  citations: Parameters<typeof sourceReferences>[0][number][];
};

/** A question shows its Source below it, so its citation tags are left out. */
const untagged = (text: string) => text.replace(/\s*\[S\d+\]/g, "");

const verdicts = {
  correct: {
    label: "Richtig",
    Icon: BadgeCheck,
    box: "bg-success-50",
    icon: "text-success-500",
    title: "text-success-600",
    text: "text-success-800",
  },
  partial: {
    label: "Teilweise richtig",
    Icon: TriangleAlert,
    box: "bg-warning-50",
    icon: "text-warning-500",
    title: "text-warning-600",
    text: "text-warning-800",
  },
  incorrect: {
    label: "Noch nicht richtig",
    Icon: OctagonX,
    box: "bg-destructive-50",
    icon: "text-destructive-500",
    title: "text-destructive-600",
    text: "text-destructive-800",
  },
  ungraded: {
    label: "Konnte nicht bewertet werden",
    Icon: CircleAlert,
    box: "bg-base-50",
    icon: "text-base-400",
    title: "text-base-600",
    text: "text-base-600",
  },
};

/** Feedback text with its citation tags as Citations, in the Feedback's own color. */
function Cited({
  text,
  citations,
}: Pick<Item, "citations"> & { text: string }) {
  const references = sourceReferences(citations);
  return text.split(/(\[S\d+\])/).map((part, i) => {
    const reference = references.find(({ tag }) => part === `[${tag}]`);
    return reference ? (
      <Citation
        // biome-ignore lint/suspicious/noArrayIndexKey: The text's parts never move.
        key={i}
        tag={reference.tag}
        title={reference.label}
        href={reference.href}
        className="[&_button]:h-auto [&_button]:px-0 [&_button]:align-baseline [&_button]:text-sm [&_button]:font-medium [&_button]:text-current [&_button]:underline [&_button]:underline-offset-4"
      />
    ) : (
      part
    );
  });
}

function Feedback({ attempt }: { attempt: Attempt }) {
  const verdict = verdicts[attempt.verdict ?? "ungraded"];
  return (
    <section
      aria-label="Feedback"
      className={cn("flex flex-col gap-1 rounded-lg px-5 py-4", verdict.box)}
    >
      <p
        className={cn(
          "flex items-center gap-2 text-sm leading-5 font-medium",
          verdict.title,
        )}
      >
        <verdict.Icon
          aria-hidden
          className={cn("size-4 shrink-0", verdict.icon)}
        />
        {verdict.label}
      </p>
      <p className={cn("text-sm leading-6", verdict.text)}>
        {attempt.verdict === null ? (
          attempt.ungradedReason === "allowance_exhausted" ? (
            "Dein KI-Kontingent ist aufgebraucht."
          ) : (
            "Versuch es noch einmal."
          )
        ) : attempt.feedback ? (
          <Cited
            text={attempt.feedback.text}
            citations={attempt.feedback.citations}
          />
        ) : (
          "Das Feedback ist weg, weil eine Quelle gelöscht wurde."
        )}
      </p>
    </section>
  );
}

/** Where a jump to a question puts its top (`scroll-mt-8`), with some room for rounding. */
const jumpedTo = 40;

/** The list of questions beside them; the one in view is marked. */
function Questions({ items }: { items: Item[] }) {
  const [active, setActive] = useState(items[0]?.id);
  const clicked = useRef<string | null>(null);
  useEffect(() => {
    // The question in view is the last one whose top reached where a jump puts it. At the end of the page the last
    // questions cannot get there, so the one the student jumped to, or else the last, is in view.
    const mark = () => {
      const end =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 2;
      if (end) {
        setActive(clicked.current ?? items.at(-1)?.id);
        return;
      }
      clicked.current = null;
      let passed = items[0]?.id;
      for (const item of items) {
        const top = document
          .getElementById(`frage-${item.id}`)
          ?.getBoundingClientRect().top;
        if (top !== undefined && top <= jumpedTo) passed = item.id;
      }
      setActive(passed);
    };
    window.addEventListener("scroll", mark, { passive: true });
    return () => window.removeEventListener("scroll", mark);
  }, [items]);
  return (
    <nav
      aria-label="Fragen"
      className="sticky top-8 hidden w-80 shrink-0 flex-col gap-2 self-start lg:flex"
    >
      <p className="text-xs leading-4 font-medium text-base-500">Fragen</p>
      <ol className="flex flex-col gap-4">
        {items.map((item, i) => (
          <li key={item.id}>
            <a
              href={`#frage-${item.id}`}
              onClick={() => {
                clicked.current = item.id;
                setActive(item.id);
              }}
              aria-current={active === item.id ? "location" : undefined}
              className={cn(
                "block truncate text-sm leading-5 text-base-800 hover:text-primary-600",
                active === item.id && "font-medium text-primary-500",
              )}
            >
              {`${i + 1}. ${untagged(item.question)}`}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A practice set to answer: every answer stays editable, and one button checks the new, changed and ungraded ones. */
export function PracticeSet({
  items,
  attempts,
  checking,
  error,
  onCheck,
}: {
  items: Item[];
  /** The latest Attempt on each answered item. */
  attempts: Attempt[];
  checking: boolean;
  error: string | null;
  onCheck: (answers: { itemId: string; text: string }[]) => void;
}) {
  const latest = new Map(attempts.map((attempt) => [attempt.itemId, attempt]));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Until the student edits an answer, it is their latest one.
  const textOf = (id: string) => drafts[id] ?? latest.get(id)?.text ?? "";
  const due = items.filter((item) => {
    const text = textOf(item.id);
    const last = latest.get(item.id);
    return text.trim() && (!last || last.text !== text || !last.verdict);
  });
  return (
    <div className="flex items-start gap-16">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <div className="flex flex-col gap-12">
          {items.map((item, i) => {
            const attempt = latest.get(item.id);
            const sources = [
              ...new Set(sourceReferences(item.citations).map((r) => r.label)),
            ];
            return (
              <article
                key={item.id}
                id={`frage-${item.id}`}
                aria-labelledby={`frage-${item.id}-titel`}
                className="flex scroll-mt-8 flex-col gap-3"
              >
                <h2
                  id={`frage-${item.id}-titel`}
                  className="text-base leading-6 font-medium text-base-800"
                >
                  {`${i + 1}. ${untagged(item.question)}`}
                </h2>
                <Textarea
                  aria-label="Deine Antwort"
                  placeholder="Deine Antwort"
                  value={textOf(item.id)}
                  disabled={checking}
                  onChange={(event) =>
                    setDrafts((all) => ({
                      ...all,
                      [item.id]: event.target.value,
                    }))
                  }
                />
                {sources.length > 0 && (
                  <p className="text-xs leading-4 text-base-500">
                    Quelle: {sources.join("; ")}
                  </p>
                )}
                {attempt && (
                  <div className="pt-2">
                    <Feedback attempt={attempt} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <div className="flex flex-col items-start gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={checking || !due.length}
            onClick={() =>
              onCheck(
                due.map((item) => ({ itemId: item.id, text: textOf(item.id) })),
              )
            }
          >
            {checking ? (
              <span className="shimmer">Wird geprüft…</span>
            ) : (
              "Antworten prüfen"
            )}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive-700">
              {error}
            </p>
          )}
        </div>
      </div>
      <Questions items={items} />
    </div>
  );
}
