"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@nunio/ui/components/input-group/input-group";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/features/shared/components/page-header";
import type { AgentTemplate } from "./api/agent-queries";
import { agentTemplatesQueries } from "./api/agent-queries";
import { TemplateCard } from "./components/template-card";
import { TemplateDetailsDialog } from "./components/template-details-dialog";

/** Browse and search all curated Agent Templates, then open one's details to start a prefilled Agent. */
export function TemplatesScreen({ apiOrigin }: { apiOrigin: string }) {
  const templates = useQuery(agentTemplatesQueries(apiOrigin));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AgentTemplate | null>(null);
  const words = search.trim().toLocaleLowerCase("de");
  const shown = (templates.data ?? []).filter((template) =>
    `${template.name}\n${template.description}`
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
              <BreadcrumbLink render={<Link href="/agents" />}>
                Agenten
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Templates</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col px-8 pt-22 pb-16">
        <Link
          href="/agents"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-base-600 hover:text-base-800"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Zurück
        </Link>
        <h1 className="mt-4 text-2xl leading-8 font-medium text-base-800">
          Templates
        </h1>
        <InputGroup className="mt-6 max-w-96">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Templates durchsuchen"
            placeholder="Templates durchsuchen …"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        {templates.error && (
          <p role="alert" className="mt-6 text-sm text-destructive-600">
            {templates.error.message}
          </p>
        )}
        {shown.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => setSelected(template)}
              />
            ))}
          </div>
        )}
        {!!templates.data?.length && shown.length === 0 && (
          <p className="mt-6 text-sm text-base-600">
            Kein Template passt zu deiner Suche.
          </p>
        )}
      </div>
      <TemplateDetailsDialog
        apiOrigin={apiOrigin}
        template={selected}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
