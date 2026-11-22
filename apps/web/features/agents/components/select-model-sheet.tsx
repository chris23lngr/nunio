"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nunio/ui/components/sheet/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nunio/ui/components/tooltip/tooltip";
import { useId, useState } from "react";
import type { ChatModel } from "@/features/chat/api/model-queries";
import { ModelLogo } from "@/features/shared/components/model-logo";

/** "Modell auswählen": picks the Agent's Model among those Chat offers, each with its logo and, on hover or keyboard focus, its description. */
export function SelectModelSheet({
  open,
  offered,
  loading,
  error,
  selected,
  onSave,
  onClose,
}: {
  open: boolean;
  offered: ChatModel[];
  loading: boolean;
  error?: string;
  /** The Agent's Model by key; one Chat no longer offers is not listed, so nothing starts picked. */
  selected: string | null;
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right">
        {/* Remounted on each opening, so the choice starts from the Agent's Model. */}
        {open && (
          <ModelChoice
            offered={offered}
            loading={loading}
            error={error}
            selected={selected}
            onSave={onSave}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ModelChoice({
  offered,
  loading,
  error,
  selected,
  onSave,
  onClose,
}: {
  offered: ChatModel[];
  loading: boolean;
  error?: string;
  selected: string | null;
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(selected);
  const descriptions = useId();
  return (
    <>
      <SheetHeader>
        <SheetTitle>Modell auswählen</SheetTitle>
        <SheetDescription>
          Bestimme, mit welchem Modell dein Agent arbeitet.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-6">
        {loading && (
          <p role="status" className="text-sm text-base-500">
            Modelle laden …
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive-600">
            {error}
          </p>
        )}
        {!loading && !error && !offered.length && (
          <p className="text-sm text-base-500">
            Gerade ist kein Modell verfügbar.
          </p>
        )}
        {!!offered.length && (
          <div
            role="radiogroup"
            aria-label="Modelle"
            className="flex flex-col gap-3"
          >
            {offered.map((model) => {
              const chosen = model.key === picked;
              return (
                <Tooltip key={model.key}>
                  {/* The whole card shows the description on hover and on keyboard focus. Arrow keys check a radio
                      with a click, which must not close it. */}
                  <TooltipTrigger render={<div />} closeOnClick={false}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 shadow-xs outline has-focus-visible:ring-2 has-focus-visible:ring-primary-500 has-focus-visible:ring-offset-4 has-focus-visible:ring-offset-white ${
                        chosen
                          ? "bg-primary-50 outline-primary-500/70"
                          : "bg-white outline-base-700/15 hover:bg-base-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="agent-model"
                        value={model.key}
                        checked={chosen}
                        onChange={() => setPicked(model.key)}
                        aria-label={model.name}
                        aria-describedby={`${descriptions}-${model.key}`}
                        className="sr-only"
                      />
                      {/* The tooltip only exists while shown, so screen readers get the description from here. */}
                      <span id={`${descriptions}-${model.key}`} hidden>
                        {model.description}
                      </span>
                      <ModelLogo provider={model.provider} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm leading-5 font-medium text-base-800">
                          {model.name}
                        </span>
                        <span className="text-xs leading-4 text-base-500">
                          {model.provider}
                        </span>
                      </span>
                      {/* Drawn rather than native, as the Understanding Level cards do. */}
                      <span
                        aria-hidden="true"
                        className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
                          chosen
                            ? "border-primary-500"
                            : "border-base-300 bg-white"
                        }`}
                      >
                        {chosen && (
                          <span className="size-2 rounded-full bg-primary-500" />
                        )}
                      </span>
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="left" sideOffset={8}>
                    {model.description}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <Button
          disabled={picked === null}
          onClick={() => picked !== null && onSave(picked)}
        >
          Speichern
        </Button>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
      </SheetFooter>
    </>
  );
}
