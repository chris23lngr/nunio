import type { paths } from "@nunio/api-client";
import { Citation, CitationList } from "@nunio/ui/components/citation/citation";

type SourceCitation =
  paths["/api/me/chats/{id}"]["get"]["responses"][200]["content"]["application/json"]["messages"][number]["citations"][number];

export function sourceReferences(citations: readonly SourceCitation[]) {
  return citations.map(({ tag, provenance }) => ({
    tag,
    label:
      provenance === "gone"
        ? "Diese Quelle wurde gelöscht."
        : provenance.kind === "source"
          ? `${provenance.title}, Seite ${provenance.location.page}`
          : "Dein eigener Eintrag",
    href:
      provenance !== "gone" && provenance.kind === "source"
        ? `/sources/${encodeURIComponent(provenance.sourceId)}?page=${provenance.location.page}`
        : undefined,
  }));
}

export function SourceCitations({
  citations,
}: {
  citations: readonly SourceCitation[];
}) {
  if (!citations.length) return null;
  return (
    <CitationList aria-label="Quellen">
      {sourceReferences(citations).map(({ tag, label, href }) => (
        <Citation key={tag} tag={tag} title={label} href={href} />
      ))}
    </CitationList>
  );
}
