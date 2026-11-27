"use client";

import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nunio/ui/components/collapsible/collapsible";
import { ChevronRight, Lock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type {
  AgentConnection,
  AgentConnectionTools,
} from "../api/agent-queries";

/** What a tool's row says under its label: a read runs without asking; a write's mode is set on the Connection's page. */
function ModeLine({ tool }: { tool: AgentConnection["tools"][number] }) {
  if (tool.mode === "always_asks")
    return (
      <span className="flex items-center gap-1.5">
        <Lock aria-hidden="true" className="size-3 text-base-500" />
        Fragt immer
      </span>
    );
  if (tool.mode === null) return <span>Ohne Nachfrage</span>;
  return (
    <span>
      {tool.mode === "always_allowed" ? "Immer erlaubt" : "Nachfragen"} · gilt
      für alle Chats und Agents
    </span>
  );
}

/**
 * The drawer's Connection sections (ADR-0001 "Grants on a Connection's tools"): every Connection the student has is a
 * collapsible section with one checkbox per tool an Agent can have, all off at first. A write tool's mode is shown,
 * never set, here; "Verbindung öffnen" leads to the Connection's page, where it is set.
 */
export function ConnectionToolSections({
  connections,
  query,
  checked,
  onChange,
}: {
  connections: AgentConnection[];
  /** The drawer's search: only tools whose label matches show. */
  query: string;
  checked: AgentConnectionTools[];
  onChange: (checked: AgentConnectionTools[]) => void;
}) {
  const matches = (label: string) =>
    label.toLowerCase().includes(query.trim().toLowerCase());
  const isOn = (integrationKey: string, tool: string) =>
    checked.some(
      (each) =>
        each.integrationKey === integrationKey && each.tools.includes(tool),
    );
  const toggle = (integrationKey: string, tool: string) => {
    const tools =
      checked.find((each) => each.integrationKey === integrationKey)?.tools ??
      [];
    const next = tools.includes(tool)
      ? tools.filter((each) => each !== tool)
      : [...tools, tool];
    onChange([
      ...checked.filter((each) => each.integrationKey !== integrationKey),
      ...(next.length ? [{ integrationKey, tools: next }] : []),
    ]);
  };
  return connections
    .filter((connection) => connection.tools.some((t) => matches(t.label)))
    .map((connection) => (
      <Collapsible
        key={connection.integrationKey}
        defaultOpen
        aria-label={connection.name}
      >
        <div className="flex items-center gap-2">
          <CollapsibleTrigger className="group flex items-center gap-2 text-base font-medium text-base-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500">
            <ChevronRight
              aria-hidden="true"
              className="size-4 text-base-500 transition-transform group-data-panel-open:rotate-90"
            />
            <Image
              src={connection.logo}
              width={20}
              height={20}
              alt=""
              className="size-5 rounded-sm"
            />
            {connection.name}
          </CollapsibleTrigger>
          <span className="text-xs text-base-500">
            {connection.state === "needs_reconnection"
              ? "Verbindung · Neu verbinden nötig"
              : "Verbindung"}
          </span>
          <Link
            href={`/settings/connections/${connection.integrationKey}`}
            className="ml-auto text-sm font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            Verbindung öffnen
          </Link>
        </div>
        <CollapsibleContent>
          <ul className="flex flex-col gap-6 pt-4 pl-6">
            {connection.tools
              .filter((tool) => matches(tool.label))
              .map((tool) => {
                const id = `agent-connection-tool-${connection.integrationKey}-${tool.name}`;
                return (
                  <li key={tool.name}>
                    <label
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-3"
                    >
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        checked={isOn(connection.integrationKey, tool.name)}
                        onCheckedChange={() =>
                          toggle(connection.integrationKey, tool.name)
                        }
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm leading-5 font-medium text-base-800">
                          {tool.label}
                        </span>
                        <span className="text-xs leading-4 text-base-500">
                          <ModeLine tool={tool} />
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    ));
}
