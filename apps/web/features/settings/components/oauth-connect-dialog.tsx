import { Button } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nunio/ui/components/dialog/dialog";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { leaveTo } from "@/lib/navigation";
import type { Integration } from "../api/integration-queries";
import { oauthStartMutation } from "../api/oauth-connection";
import { DataNote } from "./data-note";

type ToolClass = Integration["tools"][number]["class"];

/** The tool classes in the order the dialog lists them, with what each means to the student. */
const classes: { class: ToolClass; heading: string }[] = [
  { class: "read", heading: "Liest" },
  { class: "write", heading: "Schreibt nach deiner Freigabe" },
  { class: "write_always_asked", heading: "Fragt immer vorher" },
];

/** Why connecting at the vendor didn't work, as the callback named it; nothing was stored. */
function failureMessage(reason: string, name: string) {
  switch (reason) {
    case "cancelled":
      return `Du hast die Anmeldung bei ${name} abgebrochen. Es wurde nichts gespeichert.`;
    case "expired":
      return "Die Anmeldung ist abgelaufen oder wurde in einem anderen Fenster begonnen. Versuch es noch einmal.";
    case "already_connected":
      return `Du hast ${name} schon verbunden.`;
    default:
      return `Die Anmeldung bei ${name} hat nicht geklappt. Es wurde nichts gespeichert.`;
  }
}

/**
 * Connect dialog for an OAuth Integration (artboard 2A, the Email dialog's shell): its description, its tools by class
 * and the data note. "Mit ‹Dienst› verbinden" sends the student to the vendor, which sends them back to Verbindungen,
 * with the reason when it didn't work.
 */
export function OAuthConnectDialog({
  apiOrigin,
  integration,
  failure,
}: {
  apiOrigin: string;
  integration: Integration;
  /** The reason the callback returned with; the dialog then opens with it. */
  failure?: string;
}) {
  const [open, setOpen] = useState(failure !== undefined);
  const [shownFailure, setShownFailure] = useState(failure);
  const start = useMutation({
    ...oauthStartMutation(apiOrigin, integration),
    onSuccess: (authorizationUrl) => leaveTo(authorizationUrl),
  });
  // Between the answer and the vendor's page, the dialog stays busy.
  const leaving = start.isPending || start.isSuccess;
  const error =
    start.error?.message ??
    (shownFailure && failureMessage(shownFailure, integration.name));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (leaving) return;
        setOpen(next);
        if (next) return;
        start.reset();
        if (shownFailure) {
          setShownFailure(undefined);
          // The reason belongs to this return only, not to a reload of the page.
          window.history.replaceState(null, "", window.location.pathname);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        Verbinden
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{integration.name} verbinden</DialogTitle>
          <DialogDescription>{integration.description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {classes.map(({ class: toolClass, heading }) => {
            const tools = integration.tools.filter(
              (tool) => tool.class === toolClass,
            );
            if (tools.length === 0) return null;
            return (
              <section
                key={toolClass}
                aria-label={heading}
                className="flex flex-col gap-1.5"
              >
                <h3 className="text-sm leading-5 font-medium text-base-800">
                  {heading}
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {tools.map((tool) => (
                    <li
                      key={tool.label}
                      className="flex h-7 items-center rounded-full px-2.5 text-[13px] leading-4 text-base-600 outline-1 outline-base-300"
                    >
                      {tool.label}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {error && (
            <p role="alert" className="text-sm text-destructive-700">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter className="flex-col items-stretch gap-3.5 sm:flex-col">
          <DataNote dataNote={integration.dataNote} />
          <div className="flex justify-end gap-2">
            <DialogClose
              render={<Button variant="outline" disabled={leaving} />}
            >
              Abbrechen
            </DialogClose>
            <Button
              disabled={leaving}
              aria-busy={leaving}
              onClick={() => {
                setShownFailure(undefined);
                start.mutate();
              }}
            >
              Mit {integration.name} verbinden
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
