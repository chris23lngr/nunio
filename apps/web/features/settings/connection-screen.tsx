"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button } from "@nunio/ui/components/button/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { PageHeading } from "@/components/headings";
import type {
  ConnectionDetail,
  ConnectionTool,
  FolderRefusal,
} from "./api/connection";
import {
  ConnectionGone,
  connectionQuery,
  FoldersRefused,
  foldersMutation,
  mailboxFoldersQuery,
  toolModeMutation,
} from "./api/connection";
import { integrationQueries } from "./api/integration-queries";
import { FolderChips, foldersLine } from "./components/folder-chips";
import { SettingGroup } from "./components/setting-group";
import { SettingsNavigation } from "./components/settings-navigation";
import { StateBadge } from "./components/state-badge";

/** The tool classes in the order the page groups them, each with its heading. */
const groups: {
  class: ConnectionTool["class"];
  title: string;
  description: string;
}[] = [
  {
    class: "read",
    title: "Lesen",
    description:
      "nunio liest ohne Nachfrage, wenn du die Verbindung in einem Chat oder Agent eingeschaltet hast.",
  },
  {
    class: "write",
    title: "Schreiben",
    description:
      "Nachfragen oder Immer erlaubt · gilt für alle Chats und Agents.",
  },
  {
    class: "write_always_asked",
    title: "Fragt immer",
    description: "Hier fragt nunio dich jedes Mal, bevor etwas passiert.",
  },
  {
    class: "blocked",
    title: "Nicht verfügbar",
    description: "Diese Werkzeuge bietet nunio nicht an.",
  },
];

const modes = [
  { value: "ask", label: "Nachfragen" },
  { value: "always_allowed", label: "Immer erlaubt" },
] as const;

/** What a refused folder listing or change means to the student. */
const folderRefusals: Record<FolderRefusal["error"], string> = {
  login_failed: "nunio kann sich nicht mehr bei deinem Postfach anmelden.",
  unknown_folder: "Einen dieser Ordner gibt es in deinem Postfach nicht mehr.",
  port_refused: "nunio erreicht dein Postfach gerade nicht.",
  server_refused: "nunio erreicht dein Postfach gerade nicht.",
};

/**
 * A Connection's page (#289): its header, every tool nunio classified grouped by class, each grantable write tool's
 * Nachfragen / Immer erlaubt, and Email's folders.
 */
export function ConnectionScreen({
  apiOrigin,
  integrationKey,
}: {
  apiOrigin: string;
  integrationKey: string;
}) {
  const query = useQuery(connectionQuery(apiOrigin, integrationKey));
  const detail = query.data;
  return (
    <main className="mx-auto w-full max-w-[1408px] px-4 py-8 text-base-800 sm:px-8 lg:px-16 lg:py-10">
      <PageHeading className="max-md:pt-8">Einstellungen</PageHeading>
      <div className="mt-8 flex flex-col items-start gap-8 xl:mt-16 xl:flex-row">
        <SettingsNavigation active="connections" />
        <div className="flex w-full min-w-0 flex-1 flex-col gap-10">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/settings/connections" />}>
                  Verbindungen
                </BreadcrumbLink>
              </BreadcrumbItem>
              {detail && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{detail.name}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          {query.isPending && (
            <p role="status" className="text-sm text-base-500">
              Verbindung wird geladen…
            </p>
          )}
          {query.error instanceof ConnectionGone && (
            <p className="text-sm text-base-500">
              Diese Verbindung gibt es nicht mehr.
            </p>
          )}
          {query.error && !(query.error instanceof ConnectionGone) && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm text-destructive-700">
                Die Verbindung konnte nicht geladen werden.
              </p>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Erneut versuchen
              </Button>
            </div>
          )}
          {detail && (
            <>
              <ConnectionHeader detail={detail} />
              {detail.kind === "email" && (
                <EmailFolders
                  apiOrigin={apiOrigin}
                  folders={detail.connection.folders}
                />
              )}
              {groups.map((group) => {
                const tools = detail.tools.filter(
                  (tool) => tool.class === group.class,
                );
                if (tools.length === 0) return null;
                return (
                  <SettingGroup
                    key={group.class}
                    title={group.title}
                    description={group.description}
                  >
                    <ul className="divide-y divide-base-200">
                      {tools.map((tool) => (
                        <ToolRow
                          key={tool.name}
                          apiOrigin={apiOrigin}
                          integrationKey={integrationKey}
                          tool={tool}
                        />
                      ))}
                    </ul>
                  </SettingGroup>
                );
              })}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function ConnectionHeader({ detail }: { detail: ConnectionDetail }) {
  return (
    <section
      aria-label={detail.name}
      className="flex items-center gap-4 rounded-xl bg-white px-6 py-5 shadow-sm outline-1 outline-base-700/15"
    >
      <Image
        src={detail.logo}
        width={48}
        height={48}
        alt=""
        className="size-12 shrink-0 rounded-xl"
      />
      <div className="min-w-0 flex-1">
        <h2 className="text-lg leading-7 font-medium text-base-800">
          {detail.name}
        </h2>
        <p className="mt-0.5 truncate text-sm leading-5 text-base-500">
          {detail.connection.accountLabel}
        </p>
      </div>
      <StateBadge state={detail.connection.state} />
    </section>
  );
}

/** One tool: its label, then its setting, "Fragt immer" with a lock, or nothing for a read tool. */
function ToolRow({
  apiOrigin,
  integrationKey,
  tool,
}: {
  apiOrigin: string;
  integrationKey: string;
  tool: ConnectionTool;
}) {
  const queryClient = useQueryClient();
  const setMode = useMutation({
    ...toolModeMutation(apiOrigin, integrationKey),
    onSettled: () =>
      queryClient.invalidateQueries(connectionQuery(apiOrigin, integrationKey)),
  });
  const mode = tool.mode;
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex min-h-8 items-center gap-3">
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-base-800">
          {tool.label}
        </p>
        {tool.available && (mode === "ask" || mode === "always_allowed") && (
          <Select
            items={modes}
            value={mode}
            disabled={setMode.isPending}
            onValueChange={(value) => {
              if (value !== null && value !== mode)
                setMode.mutate({ toolName: tool.name, mode: value });
            }}
          >
            <SelectTrigger aria-label={tool.label} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectGroup>
                {modes.map((each) => (
                  <SelectItem key={each.value} value={each.value}>
                    {each.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        {tool.available && mode === "always_asks" && (
          <span className="flex shrink-0 items-center gap-1.5 text-[13px] leading-4 text-base-600">
            <Lock aria-hidden className="size-3.5 text-base-500" />
            Fragt immer
          </span>
        )}
      </div>
      {setMode.error && (
        <p role="alert" className="text-xs leading-4 text-destructive-700">
          {setMode.error.message}
        </p>
      )}
    </li>
  );
}

/** Email's folder chips: the student changes what nunio reads without signing in again. */
function EmailFolders({
  apiOrigin,
  folders: saved,
}: {
  apiOrigin: string;
  /** The folders nunio reads now, by IMAP path. */
  folders: string[];
}) {
  const queryClient = useQueryClient();
  const mailbox = useQuery(mailboxFoldersQuery(apiOrigin));
  const [selected, setSelected] = useState(saved);
  const save = useMutation({
    ...foldersMutation(apiOrigin),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(connectionQuery(apiOrigin, "email")),
        queryClient.invalidateQueries(integrationQueries(apiOrigin)),
      ]);
    },
  });
  const changed =
    selected.length !== saved.length ||
    selected.some((folder) => !saved.includes(folder));
  const refusal = mailbox.error ?? save.error;
  return (
    <SettingGroup
      title="Ordner, die nunio lesen darf"
      description="Du änderst sie hier, ohne dich neu anzumelden."
      footer={
        mailbox.data && (
          <Button
            disabled={!changed || selected.length === 0 || save.isPending}
            aria-busy={save.isPending}
            onClick={() => save.mutate(selected)}
          >
            Speichern
          </Button>
        )
      }
    >
      {mailbox.data ? (
        <FolderChips
          folders={mailbox.data}
          selected={selected}
          onChange={setSelected}
        />
      ) : (
        <p className="text-sm text-base-600">{foldersLine(saved)}</p>
      )}
      {mailbox.isPending && (
        <p role="status" className="mt-2 text-xs leading-4 text-base-500">
          Ordner werden geladen…
        </p>
      )}
      {refusal && (
        <p role="alert" className="mt-2 text-sm text-destructive-700">
          {refusal instanceof FoldersRefused
            ? folderRefusals[refusal.refusal.error]
            : mailbox.error
              ? "Die Ordner konnten nicht geladen werden."
              : refusal.message}
        </p>
      )}
    </SettingGroup>
  );
}
