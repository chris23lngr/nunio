"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { Blocks, ChevronRight } from "lucide-react";
import Link from "next/link";

/** A Connection the student can switch on for a Chat, by its Integration. */
export type ConnectionOption = { key: string; name: string };

/** The composer's "Verbindungen" chip: one switch per Connection, so a Chat reads only what the student switches on. */
export function ConnectionSelector({
  connections,
  selected,
  error,
  onToggle,
}: {
  connections: ConnectionOption[];
  /** The selected Connections, by Integration key. */
  selected: string[];
  error?: string;
  onToggle: (key: string) => void;
}) {
  const names = connections
    .filter((connection) => selected.includes(connection.key))
    .map((connection) => connection.name);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" />}
        aria-label={
          names.length
            ? `Verbindungen, eingeschaltet: ${names.join(", ")}`
            : undefined
        }
        className="min-w-0 pr-2 pl-2.5 leading-5 data-popup-open:bg-base-100 data-popup-open:shadow-none"
      >
        <Blocks
          className={
            names.length ? "size-4 text-primary-500" : "size-4 text-base-500"
          }
        />
        <span className="truncate">
          {names.length ? names.join(", ") : "Verbindungen"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        className="max-w-[calc(100vw-32px)] min-w-[336px]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pb-1 text-sm text-base-800">
            Verbindungen in diesem Chat
          </DropdownMenuLabel>
          <p className="px-2 pb-2 text-xs text-base-500">
            Nur was du hier einschaltest, kann nunio lesen.
          </p>
          {error && (
            <p role="alert" className="max-w-xs px-2 text-sm">
              {error}
            </p>
          )}
          {!error && !connections.length && (
            <p className="px-2 text-sm text-base-500">
              Noch keine Verbindungen.
            </p>
          )}
          {connections.map((connection) => (
            <DropdownMenuSwitchItem
              key={connection.key}
              checked={selected.includes(connection.key)}
              onCheckedChange={() => onToggle(connection.key)}
              closeOnClick={false}
            >
              <span className="min-w-0 truncate">{connection.name}</span>
            </DropdownMenuSwitchItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/settings/connections" />}>
            Integrationen verwalten
            <ChevronRight className="ml-auto" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
