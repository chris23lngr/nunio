"use client";

import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nunio/ui/components/collapsible/collapsible";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@nunio/ui/components/input-group/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nunio/ui/components/sheet/sheet";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import type {
  AgentCapability,
  ApprovalMode,
  Capability,
} from "../api/agent-queries";
import { modes } from "../capability-mode";

/**
 * "Fähigkeiten verwalten": picks the Agent's Capabilities from the capability set, by section. A checked Action
 * Capability shows its mode, starting on its default; one with a single mode, such as Lernblöcke verschieben, is fixed.
 */
export function EditCapabilitiesSheet({
  open,
  offered,
  loading,
  error,
  selected,
  onSave,
  onClose,
}: {
  open: boolean;
  offered: Capability[];
  loading: boolean;
  error?: string;
  selected: AgentCapability[];
  onSave: (capabilities: AgentCapability[]) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right">
        {/* Remounted on each opening, so the checkboxes start from the Agent's Capabilities. */}
        {open && (
          <CapabilityChoice
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

function CapabilityChoice({
  offered,
  loading,
  error,
  selected,
  onSave,
  onClose,
}: {
  offered: Capability[];
  loading: boolean;
  error?: string;
  selected: AgentCapability[];
  onSave: (capabilities: AgentCapability[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(selected);
  const [query, setQuery] = useState("");
  const shown = offered.filter((capability) =>
    capability.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const sections = [...new Set(shown.map((capability) => capability.section))];
  const modeOf = (id: Capability["id"]) =>
    checked.find((each) => each.id === id)?.mode;
  const toggle = (capability: Capability) =>
    setChecked((current) =>
      current.some((each) => each.id === capability.id)
        ? current.filter((each) => each.id !== capability.id)
        : [...current, { id: capability.id, mode: capability.modes[0]! }],
    );
  const setMode = (id: Capability["id"], mode: ApprovalMode) =>
    setChecked((current) =>
      current.map((each) => (each.id === id ? { id, mode } : each)),
    );
  return (
    <>
      <SheetHeader>
        <SheetTitle>Fähigkeiten verwalten</SheetTitle>
        <SheetDescription>
          Bestimme, welche Fähigkeiten dein Agent haben darf.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-6">
        <InputGroup className="max-w-96">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Fähigkeiten durchsuchen"
            placeholder="Fähigkeiten durchsuchen …"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        {loading && (
          <p role="status" className="text-sm text-base-500">
            Fähigkeiten laden …
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive-600">
            {error}
          </p>
        )}
        {!!offered.length && !shown.length && (
          <p className="text-sm text-base-500">
            Keine Fähigkeit passt zu deiner Suche.
          </p>
        )}
        {!!sections.length && (
          <div className="flex flex-col gap-4.5">
            {sections.map((section) => (
              <Collapsible key={section} defaultOpen>
                <CollapsibleTrigger className="group flex items-center gap-2 text-base font-medium text-base-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500">
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 text-base-500 transition-transform group-data-panel-open:rotate-90"
                  />
                  {section}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="flex flex-col gap-6 pt-4 pl-6">
                    {shown
                      .filter((capability) => capability.section === section)
                      .map((capability) => {
                        const mode = modeOf(capability.id);
                        return (
                          <li
                            key={capability.id}
                            className="flex flex-col gap-3"
                          >
                            <label
                              htmlFor={`agent-capability-${capability.id}`}
                              className="flex cursor-pointer items-start gap-3"
                            >
                              <Checkbox
                                id={`agent-capability-${capability.id}`}
                                className="mt-0.5"
                                checked={mode !== undefined}
                                onCheckedChange={() => toggle(capability)}
                              />
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-sm leading-5 font-medium text-base-800">
                                  {capability.title}
                                </span>
                                <span className="text-xs leading-4 text-base-500">
                                  {capability.description}
                                </span>
                              </span>
                            </label>
                            {mode && (
                              <ModeSelect
                                capability={capability}
                                mode={mode}
                                onChange={(next) =>
                                  setMode(capability.id, next)
                                }
                              />
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <Button
          onClick={() =>
            // In the capability set's order, as the form lists them.
            onSave(
              offered.flatMap((capability) =>
                checked.filter((each) => each.id === capability.id),
              ),
            )
          }
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

/** A checked Capability's mode; disabled when it allows only one. */
function ModeSelect({
  capability,
  mode,
  onChange,
}: {
  capability: Capability;
  mode: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
}) {
  const allowed = modes.filter((each) => capability.modes.includes(each.mode));
  return (
    <Select
      value={mode}
      onValueChange={(value) => value && onChange(value)}
      disabled={allowed.length === 1}
      items={allowed.map((each) => ({ value: each.mode, label: each.label }))}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Freigabemodus für ${capability.title}`}
        className="ml-7"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" sideOffset={8} alignItemWithTrigger={false}>
        <SelectGroup>
          {allowed.map((each) => (
            <SelectItem key={each.mode} value={each.mode}>
              {each.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
