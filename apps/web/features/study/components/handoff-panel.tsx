import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CloudUpload, FileText, Mail, Shield } from "lucide-react";
import Link from "next/link";
import { createApiClient } from "@/lib/api-client";
import type { Handoff } from "../api/study-queries";
import { coursesQueries, handoffQuery } from "../api/study-queries";
import { confirmedText, provenanceText, reportedText } from "../study-format";
import { EmailDestination } from "./email-destination";

/** What the student needs to hand the Obligation in themselves; nothing is sent anywhere. */
export function HandoffPanel({
  apiOrigin,
  handoff,
}: {
  apiOrigin: string;
  handoff: Handoff;
}) {
  const queryClient = useQueryClient();
  const { obligation, rule, drafts, mailto } = handoff;
  const report = useMutation({
    mutationFn: async (reported: boolean) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/obligations/{id}/reported-submitted",
        { params: { path: { id: obligation.id } }, body: { reported } },
      );
      if (!result.data) throw new Error("Das konnte nicht gespeichert werden.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: handoffQuery(apiOrigin, obligation.id).queryKey,
      });
      queryClient.invalidateQueries({
        queryKey: coursesQueries(apiOrigin).queryKey,
      });
    },
  });

  const confirmEmail = useMutation({
    mutationFn: async (address: string | null) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/obligations/{id}/email-destination",
        { params: { path: { id: obligation.id } }, body: { address } },
      );
      if (result.response.status === 400)
        throw new Error("Das ist keine gültige E-Mail-Adresse.");
      if (!result.data) throw new Error("Das konnte nicht gespeichert werden.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: handoffQuery(apiOrigin, obligation.id).queryKey,
      }),
  });
  const { emailDestination, emailPrefill } = obligation;
  // Nothing confirmed, or only the Course's default while the Obligation's own wording names another address.
  const suggested =
    emailPrefill &&
    (!emailDestination ||
      (emailDestination.level === "course" &&
        emailDestination.address.toLowerCase() !==
          emailPrefill.address.toLowerCase()))
      ? emailPrefill
      : null;

  const shownDrafts = rule.status === "forbidden" ? drafts : drafts.slice(0, 1);

  return (
    <section aria-label="Abgabe vorbereiten" className="flex flex-col gap-4">
      <div className="flex flex-col overflow-clip rounded-xl border border-base-200 bg-white shadow-[0_1px_3px_#0000000d]">
        <div className="flex flex-col gap-0.5 px-4.5 pt-4 pb-3.5">
          <h2 className="text-base font-medium text-base-800">
            Abgabe vorbereiten
          </h2>
          <p className="text-[13px] leading-4.5 text-base-500">
            Abgeben musst du selbst. nunio legt dir alles zurecht.
          </p>
        </div>
        <div className="flex flex-col px-4.5">
          <div className="flex gap-3 border-t border-base-200 py-3.5">
            <span className="flex w-5 shrink-0 pt-0.5">
              <CloudUpload
                aria-hidden="true"
                className="size-4 text-base-500"
              />
            </span>
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-xs font-medium text-base-500">
                Abgeben über
              </span>
              {obligation.destination ? (
                <>
                  <span className="text-sm font-medium text-base-800">
                    {obligation.destination}
                  </span>
                  <span className="text-xs text-base-500">
                    Laut deiner Quelle; nunio hat das nicht geprüft.
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm text-base-800">
                    Deine Quellen sagen nicht, wo du abgibst.
                  </span>
                  <span className="text-xs text-base-500">
                    Frag im Kurs nach oder trag es selbst ein.
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-3 border-t border-base-200 py-3.5">
            <span className="flex w-5 shrink-0 pt-0.5">
              <Mail aria-hidden="true" className="size-4 text-base-500" />
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <span className="text-xs font-medium text-base-500">
                Abgabe per E-Mail
              </span>
              <EmailDestination
                confirmed={
                  emailDestination && {
                    address: emailDestination.address,
                    note:
                      emailDestination.level === "course"
                        ? "Standard des Kurses"
                        : confirmedText(emailDestination.confirmedAt),
                  }
                }
                prefill={
                  suggested && {
                    address: suggested.address,
                    note: `${provenanceText(suggested.provenance)} · noch nicht bestätigt`,
                  }
                }
                pending={confirmEmail.isPending}
                error={confirmEmail.error?.message ?? null}
                onConfirm={(address) => confirmEmail.mutateAsync(address)}
                onClear={
                  emailDestination?.level === "obligation"
                    ? () => confirmEmail.mutate(null)
                    : null
                }
                onDismissError={confirmEmail.reset}
              />
              {mailto && (
                <span className="text-xs text-base-500">
                  <a
                    href={mailto}
                    className="font-medium text-primary-600 hover:text-primary-700"
                  >
                    E-Mail vorbereiten
                  </a>
                  {" · "}Häng deine Datei selbst an und sende sie ab.
                </span>
              )}
            </div>
          </div>
          {rule.status === "conditional" && (
            <div className="flex gap-3 border-t border-base-200 py-3.5">
              <span className="flex w-5 shrink-0 pt-0.5">
                <Shield
                  aria-hidden="true"
                  className="size-4 text-warning-600"
                />
              </span>
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-xs font-medium text-base-500">
                  Denk an die KI-Bedingungen
                </span>
                <span className="text-sm text-base-800">
                  {rule.text ??
                    "Du hast angegeben, dass dein Kurs KI unter Bedingungen erlaubt. Halte dich daran."}
                </span>
              </div>
            </div>
          )}
          <div className="flex gap-3 border-t border-base-200 py-3.5">
            <span className="flex w-5 shrink-0 pt-0.5">
              <FileText aria-hidden="true" className="size-4 text-base-500" />
            </span>
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-xs font-medium text-base-500">
                Deine Grundlage
              </span>
              {shownDrafts.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {shownDrafts.map((draft) => (
                    <Link
                      key={draft.id}
                      href={`/artifacts/${draft.id}`}
                      className="text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      Entwurf, Version {draft.version}
                    </Link>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-base-500">Noch kein Entwurf</span>
              )}
            </div>
          </div>
        </div>
        {!obligation.reportedSubmittedAt && (
          <div className="flex flex-col gap-2.5 border-t border-base-200 bg-base-50 px-4.5 pt-3.5 pb-4">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={report.isPending}
              onClick={() => report.mutate(true)}
            >
              Ich habe abgegeben
            </Button>
            <p className="text-center text-xs text-base-500">
              Danach plant nunio keine Zeit mehr für diese Abgabe ein.
            </p>
          </div>
        )}
      </div>
      {obligation.reportedSubmittedAt && (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-success-500/30 bg-success-50 px-3.5 py-3">
          <CircleCheck
            aria-hidden="true"
            className="size-4 shrink-0 text-success-600"
          />
          <span className="flex-1 text-[13px] leading-4.5 text-success-800">
            {reportedText(obligation.reportedSubmittedAt)}
          </span>
          <button
            type="button"
            disabled={report.isPending}
            onClick={() => report.mutate(false)}
            className="cursor-pointer text-[13px] leading-4.5 font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
          >
            Zurücknehmen
          </button>
        </div>
      )}
      {report.error && (
        <p role="alert" className="text-[13px] text-destructive-600">
          {report.error.message}
        </p>
      )}
    </section>
  );
}
