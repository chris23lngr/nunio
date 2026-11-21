"use client";

import { useQuery } from "@tanstack/react-query";
import { AgentFormScreen } from "./agent-form-screen";
import { agentCourseQueries, agentTemplatesQueries } from "./api/agent-queries";

/**
 * A new free-text Agent: blank, or prefilled from a curated Template ("Template verwenden"). Saves nothing until the
 * student presses Speichern.
 */
export function NewAgentScreen({
  apiOrigin,
  templateId,
}: {
  apiOrigin: string;
  templateId?: string;
}) {
  const templates = useQuery({
    ...agentTemplatesQueries(apiOrigin),
    enabled: Boolean(templateId),
  });
  const template = templateId
    ? (templates.data?.find((each) => each.id === templateId) ?? null)
    : null;
  const preselectAllCourses = template?.courses === "all_active";
  const offered = useQuery({
    ...agentCourseQueries(apiOrigin),
    enabled: preselectAllCourses,
  });

  if (!templateId)
    return <AgentFormScreen apiOrigin={apiOrigin} agent={null} />;
  if (templates.isPending) return null;
  if (templates.error) {
    return (
      <main className="p-8">
        <p role="alert" className="text-sm text-destructive-600">
          {templates.error.message}
        </p>
      </main>
    );
  }
  if (!template) return <AgentFormScreen apiOrigin={apiOrigin} agent={null} />;
  if (preselectAllCourses && offered.isPending) return null;

  return (
    <AgentFormScreen
      key={template.id}
      apiOrigin={apiOrigin}
      agent={null}
      template={template}
      initialCourses={preselectAllCourses ? (offered.data ?? []) : []}
    />
  );
}
