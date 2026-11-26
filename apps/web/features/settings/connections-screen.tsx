"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { PageHeading } from "@/components/headings";
import type { Integration } from "./api/integration-queries";
import { integrationQueries } from "./api/integration-queries";
import { EmailConnectDialog } from "./components/email-connect-dialog";
import { OAuthConnectDialog } from "./components/oauth-connect-dialog";
import { SettingGroup } from "./components/setting-group";
import { SettingsNavigation } from "./components/settings-navigation";

export function ConnectionsScreen({
  apiOrigin,
  returned,
}: {
  apiOrigin: string;
  /** Back from a vendor without a Connection: the Integration and why, to reopen its Connect dialog. */
  returned?: { integrationKey: string; error: string };
}) {
  const query = useQuery(integrationQueries(apiOrigin));
  const connected = query.data?.filter((i) => i.connection !== null) ?? [];
  const available = query.data?.filter((i) => i.connection === null) ?? [];
  return (
    <main className="mx-auto w-full max-w-[1408px] px-4 py-8 text-base-800 sm:px-8 lg:px-16 lg:py-10">
      <PageHeading className="max-md:pt-8">Einstellungen</PageHeading>
      <div className="mt-8 flex flex-col items-start gap-8 xl:mt-16 xl:flex-row">
        <SettingsNavigation active="connections" />
        <div className="flex w-full min-w-0 flex-1 flex-col gap-10">
          {query.isPending && (
            <p role="status" className="text-sm text-base-500">
              Verbindungen werden geladen…
            </p>
          )}
          {query.error && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm text-destructive-700">
                Die Verbindungen konnten nicht geladen werden.
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
          {query.data && (
            <>
              <SettingGroup
                title="Verbunden"
                description="Dienste, die nunio in Chats und Agents für dich nutzen darf."
              >
                {connected.length === 0 ? (
                  <p className="py-3 text-sm text-base-500">
                    Du hast noch keine Dienste verbunden.
                  </p>
                ) : (
                  <ul className="divide-y divide-base-200">
                    {connected.map((integration) => (
                      <ConnectedRow
                        key={integration.key}
                        integration={integration}
                      />
                    ))}
                  </ul>
                )}
              </SettingGroup>
              <SettingGroup
                title="Verfügbar"
                description="Von nunio geprüfte Dienste. Du meldest dich einmal an, danach entscheidest du pro Chat und Agent."
              >
                {available.length === 0 ? (
                  <p className="py-3 text-sm text-base-500">
                    Gerade bietet nunio keine Dienste an.
                  </p>
                ) : (
                  <ul className="divide-y divide-base-200">
                    {available.map((integration) => (
                      <li
                        key={integration.key}
                        className="flex items-center gap-3 py-3"
                      >
                        <Image
                          src={integration.logo}
                          width={36}
                          height={36}
                          alt=""
                          className="size-9 shrink-0 rounded-lg"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-5 font-medium text-base-800">
                            {integration.name}
                          </p>
                          <p className="mt-0.5 text-xs leading-4 text-base-500">
                            {integration.description} · {integration.dataNote}
                          </p>
                        </div>
                        {integration.kind === "email" ? (
                          <EmailConnectDialog
                            apiOrigin={apiOrigin}
                            dataNote={integration.dataNote}
                          />
                        ) : (
                          <OAuthConnectDialog
                            apiOrigin={apiOrigin}
                            integration={integration}
                            failure={
                              returned?.integrationKey === integration.key
                                ? returned.error
                                : undefined
                            }
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </SettingGroup>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** What a Connection reads and which Agents use it, as one line. */
function readsLine(connection: NonNullable<Integration["connection"]>) {
  const parts = [];
  if (connection.folders.length > 0)
    parts.push(
      `Lesen: ${connection.folders
        .map((folder) => (folder === "INBOX" ? "Posteingang" : folder))
        .join(", ")}`,
    );
  if (connection.agentCount === 1) parts.push("1 Agent nutzt diese Verbindung");
  else if (connection.agentCount > 1)
    parts.push(`${connection.agentCount} Agents nutzen diese Verbindung`);
  return parts.join(" · ");
}

function ConnectedRow({ integration }: { integration: Integration }) {
  const connection = integration.connection!;
  const connected = connection.state === "connected";
  const line = readsLine(connection);
  return (
    <li className="flex items-center gap-3 py-3">
      <Image
        src={integration.logo}
        width={36}
        height={36}
        alt=""
        className="size-9 shrink-0 rounded-lg"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 font-medium text-base-800">
          {integration.name} · {connection.accountLabel}
        </p>
        {line && (
          <p className="mt-0.5 text-xs leading-4 text-base-500">{line}</p>
        )}
      </div>
      <span
        className={`flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] px-1.5 text-xs leading-4 font-medium ${
          connected
            ? "bg-success-50 text-success-800"
            : "bg-warning-50 text-warning-800"
        }`}
      >
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${connected ? "bg-success-500" : "bg-warning-500"}`}
        />
        {connected ? "Verbunden" : "Neu verbinden nötig"}
      </span>
      {/* The Connection's page comes with #289. */}
      <Button variant="ghost" disabled>
        Verwalten
      </Button>
    </li>
  );
}
