import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarMinus,
  CalendarPlus,
  CircleHelp,
  ListPlus,
  RotateCcw,
} from "lucide-react";
import {
  decideApproval,
  resolveUnconfirmed,
} from "@/features/approvals/api/approval-mutations";
import type {
  Approval,
  Unconfirmed,
} from "@/features/approvals/api/approval-queries";
import { planQuery } from "@/features/plan/api/plan-queries";
import { homeQuery } from "../api/home-queries";
import { span, when } from "../home-wording";
import {
  ItemRow,
  ItemSection,
  MetaLine,
  RowActions,
  RowText,
} from "./item-card";

type Kind = Approval["action"]["kind"];

/** What each kind of Action is called and what saying no to it leaves. */
const actions: Record<
  Kind,
  {
    icon: typeof ArrowLeftRight;
    what: (title: string) => string;
    approve: string;
    unchanged: string;
  }
> = {
  "studyBlock.create": {
    icon: CalendarPlus,
    what: (title) => `Lernblock für „${title}“ anlegen`,
    approve: "Lernblock erlauben",
    unchanged: "Ohne deine Freigabe legt nunio ihn nicht an.",
  },
  "studyBlock.move": {
    icon: ArrowLeftRight,
    what: (title) => `Lernblock für „${title}“ verschieben`,
    approve: "Verschiebung erlauben",
    unchanged: "Ohne deine Freigabe bleibt er, wo er ist.",
  },
  "studyBlock.remove": {
    icon: CalendarMinus,
    what: (title) => `Lernblock für „${title}“ entfernen`,
    approve: "Entfernen erlauben",
    unchanged: "Ohne deine Freigabe bleibt er in deinem Plan.",
  },
  "task.create": {
    icon: ListPlus,
    what: (title) => `Aufgabe „${title}“ anlegen`,
    approve: "Aufgabe erlauben",
    unchanged: "Ohne deine Freigabe legt nunio sie nicht an.",
  },
  "task.reopen": {
    icon: RotateCcw,
    what: (title) => `Aufgabe „${title}“ wieder öffnen`,
    approve: "Wieder öffnen erlauben",
    unchanged: "Ohne deine Freigabe bleibt sie erledigt.",
  },
};

const capitalized = (text: string) =>
  text.charAt(0).toLocaleUpperCase("de") + text.slice(1);

/** Where a block is now and where it would go, so the student approves exactly that (ADR-0010). */
function TimeChange({ action }: { action: Approval["action"] }) {
  if (!action.from && !action.to) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {action.from && (
        <p className="flex flex-col gap-0.5">
          <span className="text-xs text-base-600">Bisher</span>
          <span className="text-sm text-base-600 line-through">
            {span(action.from)}
          </span>
        </p>
      )}
      {action.from && action.to && (
        <span className="flex w-6 items-center justify-center">
          <ArrowRight aria-hidden="true" className="size-4 text-base-500" />
        </span>
      )}
      {action.to && (
        <p className="flex flex-col gap-0.5">
          <span className="text-xs text-base-600">Neu</span>
          <span className="text-sm font-semibold text-base-900">
            {span(action.to)}
          </span>
        </p>
      )}
    </div>
  );
}

function ApprovalRow({
  apiOrigin,
  approval,
  busy,
  onDecide,
}: {
  apiOrigin: string;
  approval: Approval;
  busy: boolean;
  onDecide: (decision: "approve" | "deny") => void;
}) {
  const { action } = approval;
  const shown = actions[action.kind];
  const asker = approval.agent?.name ?? "nunio";
  const course = action.work.course;
  return (
    <ItemRow
      icon={shown.icon}
      title={capitalized(shown.what(action.work.title))}
      meta={
        <MetaLine apiOrigin={apiOrigin} course={course}>
          {asker} fragt{course && ` für ${course}`} · läuft{" "}
          {when(approval.expiresAt)} ab
        </MetaLine>
      }
    >
      <RowText>{shown.unchanged}</RowText>
      <TimeChange action={action} />
      <RowActions>
        <Button
          className="h-8 px-3"
          disabled={busy}
          onClick={() => onDecide("approve")}
        >
          {shown.approve}
        </Button>
        <Button
          variant="outline"
          className="h-8 px-3"
          disabled={busy}
          onClick={() => onDecide("deny")}
        >
          Nicht erlauben
        </Button>
      </RowActions>
      <p className="text-xs text-base-500">
        Die Freigabe gilt nur für genau diese Änderung · Fingerabdruck{" "}
        {approval.fingerprint.slice(0, 4)} {approval.fingerprint.slice(4, 8)}
      </p>
    </ItemRow>
  );
}

function UnconfirmedRow({
  apiOrigin,
  unconfirmed,
  busy,
  onResolve,
}: {
  apiOrigin: string;
  unconfirmed: Unconfirmed;
  busy: boolean;
  onResolve: (resolution: "happened" | "did_not_happen") => void;
}) {
  const { action } = unconfirmed;
  const placed = action.to ?? action.from;
  const course = action.work.course;
  return (
    <ItemRow
      icon={CircleHelp}
      tone="warning"
      title={`Nicht bestätigt: ${actions[action.kind].what(action.work.title)}`}
      meta={
        (course || placed) && (
          <MetaLine apiOrigin={apiOrigin} course={course}>
            {[course, placed && span(placed)].filter(Boolean).join(" · ")}
          </MetaLine>
        )
      }
    >
      <RowText>
        Prüf deinen Plan und sag nunio Bescheid. nunio versucht es nicht von
        selbst erneut.
      </RowText>
      <RowActions>
        <Button
          variant="outline"
          className="h-8 px-3"
          disabled={busy}
          onClick={() => onResolve("happened")}
        >
          Ist passiert
        </Button>
        <Button
          variant="outline"
          className="h-8 px-3"
          disabled={busy}
          onClick={() => onResolve("did_not_happen")}
        >
          Ist nicht passiert
        </Button>
      </RowActions>
    </ItemRow>
  );
}

/** What nunio waits for the student to answer: Approvals and Actions it could not confirm. Hidden when there are none. */
export function WaitingSection({
  apiOrigin,
  approvals,
  unconfirmed,
  loadError,
}: {
  apiOrigin: string;
  approvals: Approval[];
  unconfirmed: Unconfirmed[];
  loadError?: Error | null;
}) {
  const queryClient = useQueryClient();
  const decide = useMutation(decideApproval(apiOrigin, queryClient));
  const resolve = useMutation(resolveUnconfirmed(apiOrigin, queryClient));
  const error = decide.error ?? resolve.error ?? loadError;
  if (!approvals.length && !unconfirmed.length && !error) return null;
  const refresh = () => {
    void queryClient.invalidateQueries(homeQuery(apiOrigin));
    void queryClient.invalidateQueries(planQuery(apiOrigin));
  };
  return (
    <ItemSection
      title="Wartet auf dich"
      count={approvals.length + unconfirmed.length || undefined}
    >
      {error && (
        <li role="alert" className="px-5 py-4 text-sm text-destructive-700">
          {error.message}
        </li>
      )}
      {approvals.map((approval) => (
        <ApprovalRow
          key={approval.actionId}
          apiOrigin={apiOrigin}
          approval={approval}
          busy={decide.isPending}
          onDecide={(decision) =>
            decide.mutate({ approval, decision }, { onSettled: refresh })
          }
        />
      ))}
      {unconfirmed.map((item) => (
        <UnconfirmedRow
          key={item.actionId}
          apiOrigin={apiOrigin}
          unconfirmed={item}
          busy={resolve.isPending}
          onResolve={(resolution) =>
            resolve.mutate(
              { actionId: item.actionId, resolution },
              { onSettled: refresh },
            )
          }
        />
      ))}
    </ItemSection>
  );
}
