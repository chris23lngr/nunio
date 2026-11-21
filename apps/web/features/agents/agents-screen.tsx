"use client";

import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { buttonVariants } from "@nunio/ui/components/button/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@nunio/ui/components/input-group/input-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/features/shared/components/page-header";
import { controlAgent } from "./api/agent-mutations";
import type { AgentRow, AgentTemplate } from "./api/agent-queries";
import { agentListQueries, agentTemplatesQueries } from "./api/agent-queries";
import { AgentMenu } from "./components/agent-menu";
import { TemplateCard } from "./components/template-card";
import { TemplateDetailsDialog } from "./components/template-details-dialog";
import { pausedLine } from "./name";

/** Each badge's words and colours; an Agent with none shows nothing. */
const badges = {
  paused: { label: "Pausiert", className: "bg-base-100 text-base-700" },
  approval_needed: {
    label: "Freigabe benötigt",
    className: "bg-warning-50 text-warning-700",
  },
  running: {
    label: "Läuft gerade",
    className: "bg-primary-100 text-primary-700",
  },
  ended: { label: "Beendet", className: "bg-base-50 text-base-500" },
} as const;

/** One Agent's row: its emoji, name, Beschreibung, badge and menu; the whole row opens it. */
function AgentListItem({
  apiOrigin,
  agent,
}: {
  apiOrigin: string;
  agent: AgentRow;
}) {
  const queryClient = useQueryClient();
  const control = useMutation(controlAgent(apiOrigin, agent.id, queryClient));
  const { name } = agent;
  const badge = agent.badge && badges[agent.badge];
  return (
    <li className="relative flex items-center gap-4 border-b border-base-200 px-2 py-3 last:border-b-0 hover:bg-base-50">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-100 text-lg"
      >
        {agent.emoji}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/agents/${agent.id}`}
          className="truncate text-sm font-medium text-base-800 outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-primary-500"
        >
          {name}
        </Link>
        {agent.description && (
          <span className="truncate text-sm text-base-500">
            {agent.description}
          </span>
        )}
        {/* The badge says Pausiert; why, unless the student paused it. */}
        {agent.state === "paused" && agent.pausedBy !== "student" && (
          <span className="truncate text-sm text-base-700">
            {pausedLine(agent.pausedBy)}
          </span>
        )}
        {control.error && (
          <span role="alert" className="text-sm text-destructive-600">
            {control.error.message}
          </span>
        )}
      </span>
      {badge && (
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      )}
      {/* Above the row's link, so the menu opens instead of the Agent. */}
      <span className="relative shrink-0">
        <AgentMenu
          apiOrigin={apiOrigin}
          agent={agent}
          name={name}
          row
          onControl={(next) => control.mutate(next)}
        />
      </span>
    </li>
  );
}

/** The student's Agents, what needs them first, with search. */
export function AgentsScreen({ apiOrigin }: { apiOrigin: string }) {
  const agents = useQuery(agentListQueries(apiOrigin));
  const templates = useQuery(agentTemplatesQueries(apiOrigin));
  const [selectedTemplate, setSelectedTemplate] =
    useState<AgentTemplate | null>(null);
  const [search, setSearch] = useState("");
  const words = search.trim().toLocaleLowerCase("de");
  const shown = (agents.data ?? []).filter((agent) =>
    `${agent.name}\n${agent.description}`
      .toLocaleLowerCase("de")
      .includes(words),
  );

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>
                Dashboard
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Agenten</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col px-8 pt-22 pb-16">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl leading-8 font-medium text-base-800">
            Agenten
          </h1>
          <Link href="/agents/new" className={cn(buttonVariants(), "pr-2")}>
            Neuer Agent
            <Plus aria-hidden="true" />
          </Link>
        </div>
        <section aria-label="Templates" className="mt-8 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-medium text-base-700">Templates</h2>
            <Link
              href="/agents/templates"
              className="text-sm font-medium text-primary-600 hover:underline"
            >
              Alle Templates
            </Link>
          </div>
          {templates.data && templates.data.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {templates.data.slice(0, 3).map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSelect={() => setSelectedTemplate(template)}
                />
              ))}
            </div>
          )}
        </section>
        <InputGroup className="mt-8 max-w-96">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Agenten durchsuchen"
            placeholder="Agenten durchsuchen …"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        {agents.error && (
          <p role="alert" className="mt-6 text-sm text-destructive-600">
            {agents.error.message}
          </p>
        )}
        {agents.data?.length === 0 && (
          <div className="mt-6 flex flex-col gap-1">
            <p className="text-sm font-medium text-base-800">
              Noch keine Agenten
            </p>
            <p className="text-sm text-base-500">
              Ein Agent übernimmt eine Aufgabe für deine Kurse, zum Beispiel
              deine Klausurvorbereitung.
            </p>
          </div>
        )}
        {shown.length > 0 && (
          <ul aria-label="Agenten" className="mt-6 flex flex-col">
            {shown.map((agent) => (
              <AgentListItem
                key={agent.id}
                apiOrigin={apiOrigin}
                agent={agent}
              />
            ))}
          </ul>
        )}
        {!!agents.data?.length && shown.length === 0 && (
          <p className="mt-6 text-sm text-base-600">
            Kein Agent passt zu deiner Suche.
          </p>
        )}
      </div>
      <TemplateDetailsDialog
        apiOrigin={apiOrigin}
        template={selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
      />
    </main>
  );
}
