import { cn } from "@nunio/ui";
import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarX,
  Check,
  Clock,
  GitCompareArrows,
  Hourglass,
} from "lucide-react";
import Link from "next/link";
import { skipRoutine } from "../api/home-mutations";
import type { Attention } from "../api/home-queries";
import { day, hours, when } from "../home-wording";
import {
  ItemRow,
  ItemSection,
  MetaLine,
  RowActions,
  RowText,
} from "./item-card";

type Shortfall = Extract<Attention, { kind: "shortfall" }>;
type Tradeoff = Shortfall["tradeoffs"][number];

const linkButton = cn(buttonVariants({ variant: "outline" }), "h-8 px-3");

/** One tradeoff the student may choose; nunio never picks one silently. */
function tradeoffText(tradeoff: Tradeoff) {
  if (tradeoff.kind === "exceed_daily_limit")
    return {
      title: "Über dein Tageslimit hinaus lernen",
      detail: `+${hours(tradeoff.gainedMinutes)} · braucht deine Freigabe`,
    };
  if (tradeoff.kind === "free_time_from")
    return {
      title: "Zeit von weniger wichtiger Arbeit nutzen",
      detail: `+${hours(tradeoff.gainedMinutes)}${tradeoff.needsApproval ? " · braucht deine Freigabe" : ""}`,
    };
  if (tradeoff.kind === "skip_routine")
    return {
      title: `Vor- und Nachbereitung von ${tradeoff.title} aussetzen`,
      detail: `+${hours(tradeoff.gainedMinutes)} · bis ${day(tradeoff.until)}`,
    };
  return {
    title: "Weniger dafür planen",
    detail: `${hours(tradeoff.byMinutes)} weniger einplanen`,
  };
}

function ShortfallRow({
  apiOrigin,
  item,
  busy,
  onSkip,
}: {
  apiOrigin: string;
  item: Shortfall;
  busy: boolean;
  onSkip: (routine: string, until: string) => void;
}) {
  return (
    <ItemRow
      icon={Hourglass}
      tone="shortfall"
      title={`Für ${item.title} fehlen ${hours(item.shortMinutes)}`}
      meta={
        <MetaLine apiOrigin={apiOrigin} course={item.course}>
          {[item.course, "Zeit fehlt", `Frist ${when(item.due)}`]
            .filter(Boolean)
            .join(" · ")}
        </MetaLine>
      }
    >
      {item.unreviewed && (
        <RowText>
          Das ist noch nicht geprüft. Kontrollier Frist und Schätzung, bevor du
          etwas änderst.
        </RowText>
      )}
      <div className="flex flex-col border-t border-base-700/10">
        {item.tradeoffs.length > 0 && (
          <ul aria-label="Möglichkeiten">
            {item.tradeoffs.map((tradeoff, i) => {
              const text = tradeoffText(tradeoff);
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: Tradeoffs have no id and the list is replaced, never reordered.
                  key={i}
                  className="flex items-center gap-3 border-b border-base-700/10 py-3"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium text-base-900">
                      {text.title}
                    </span>
                    <span className="text-xs text-base-600">{text.detail}</span>
                  </span>
                  {tradeoff.kind === "skip_routine" && (
                    <Button
                      variant="outline"
                      className="h-8 px-3"
                      aria-label={`„${tradeoff.title}“ aussetzen`}
                      disabled={busy}
                      onClick={() => onSkip(tradeoff.routine, tradeoff.until)}
                    >
                      Aussetzen
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/plan"
          className="w-fit pt-3 text-sm font-medium text-primary-700 hover:underline"
        >
          Plan öffnen
        </Link>
      </div>
    </ItemRow>
  );
}

const unplanned = {
  no_estimate: {
    title: (title: string) => `„${title}“ braucht eine Schätzung`,
    text: "Ohne Schätzung kann nunio dafür keine Zeit einplanen.",
  },
  no_deadline: {
    title: (title: string) => `„${title}“ hat keine Frist`,
    text: "Ohne Frist plant nunio dafür keine Zeit ein.",
  },
  past_due: {
    title: (title: string) => `„${title}“ ist überfällig`,
    text: "Die Frist ist vorbei, deshalb plant nunio dafür keine Zeit mehr ein.",
  },
};

const overlap = {
  locked: "Der Lernblock ist fixiert, deshalb lässt nunio ihn, wo er ist.",
  no_room:
    "Vor der Frist ist keine freie Zeit mehr, in die nunio ihn verschieben könnte.",
};

function AttentionRow({
  apiOrigin,
  item,
  busy,
  onSkip,
}: {
  apiOrigin: string;
  item: Attention;
  busy: boolean;
  onSkip: (routine: string, until: string) => void;
}) {
  if (item.kind === "shortfall")
    return (
      <ShortfallRow
        apiOrigin={apiOrigin}
        item={item}
        busy={busy}
        onSkip={onSkip}
      />
    );
  if (item.kind === "disagreement")
    return (
      <ItemRow
        icon={GitCompareArrows}
        title={`Eine neuere Quelle widerspricht bei „${item.title}“`}
        meta={
          <MetaLine apiOrigin={apiOrigin} course={item.course}>
            {item.course} · Widerspruch
          </MetaLine>
        }
      >
        <RowText>nunio übernimmt keinen Wert, bis du entscheidest.</RowText>
        <RowActions>
          <Link href="/review" className={linkButton}>
            Prüfen
          </Link>
        </RowActions>
      </ItemRow>
    );
  const { icon, title, meta, text } =
    item.kind === "overlap"
      ? {
          icon: CalendarX,
          title: `Lernblock für „${item.title}“ überschneidet jetzt deinen Kalender`,
          meta: "Überschneidung",
          text: overlap[item.reason],
        }
      : {
          icon: Clock,
          title: unplanned[item.reason].title(item.title),
          meta: "Nicht eingeplant",
          text: unplanned[item.reason].text,
        };
  return (
    <ItemRow
      icon={icon}
      title={title}
      meta={
        <MetaLine apiOrigin={apiOrigin} course={null}>
          {meta}
        </MetaLine>
      }
    >
      <RowText>{text}</RowText>
      <RowActions>
        <Link href="/plan" className={linkButton}>
          Plan öffnen
        </Link>
      </RowActions>
    </ItemRow>
  );
}

/** What needs the student's attention or a decision; on a quiet day, that nothing does. */
export function AttentionSection({
  apiOrigin,
  attention,
  quiet,
}: {
  apiOrigin: string;
  attention: Attention[];
  /** Nothing else waits for the student either. */
  quiet: boolean;
}) {
  const queryClient = useQueryClient();
  const skip = useMutation(skipRoutine(apiOrigin, queryClient));
  if (quiet && !skip.error)
    return (
      <section aria-label="Braucht dich" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-base-900">Braucht dich</h2>
        <div className="flex items-start gap-4 rounded-xl border border-base-200 bg-white px-5 py-6">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600"
          >
            <Check className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-base-900">
              Nichts braucht dich gerade.
            </p>
            <p className="text-sm text-base-600">
              Freigaben, Zeitlücken und Widersprüche erscheinen hier, sobald
              nunio sie bemerkt. Dein Plan läuft wie besprochen.
            </p>
          </div>
        </div>
      </section>
    );
  if (!attention.length && !skip.error) return null;
  return (
    <ItemSection title="Braucht dich" count={attention.length || undefined}>
      {skip.error && (
        <li role="alert" className="px-5 pt-4 text-sm text-destructive-700">
          {skip.error.message}
        </li>
      )}
      {attention.map((item, i) => (
        <AttentionRow
          // biome-ignore lint/suspicious/noArrayIndexKey: Attention items have no id and the list is replaced, never reordered.
          key={i}
          apiOrigin={apiOrigin}
          item={item}
          busy={skip.isPending}
          onSkip={(routine, until) => skip.mutate({ routine, until })}
        />
      ))}
    </ItemSection>
  );
}
