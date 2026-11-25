"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { PageHeading } from "@/components/headings";
import { integrationQueries } from "./api/integration-queries";
import { SettingGroup } from "./components/setting-group";
import { SettingsNavigation } from "./components/settings-navigation";

export function ConnectionsScreen({ apiOrigin }: { apiOrigin: string }) {
  const query = useQuery(integrationQueries(apiOrigin));
  // Connect comes with the Connect dialogs (#287, #288); until then no Integration has a Connection.
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
                <p className="py-3 text-sm text-base-500">
                  Du hast noch keine Dienste verbunden.
                </p>
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
                        {/* The Connect dialogs come in #287 and #288. */}
                        <Button variant="outline" disabled>
                          Verbinden
                        </Button>
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
