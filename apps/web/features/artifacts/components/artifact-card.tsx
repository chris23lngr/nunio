import Link from "next/link";
import { timeAgo } from "@/features/shared/time-ago";
import type { ArtifactSummary } from "../api/artifact-queries";
import { kinds } from "../artifact-kinds";

/** What the card says it is: how many items or cards, else its kind, and in which Course. */
function whatText(artifact: ArtifactSummary, course: string | undefined) {
  const { label, counted } = kinds[artifact.kind];
  const what =
    counted && artifact.count !== null
      ? `${artifact.count} ${counted[artifact.count === 1 ? 0 : 1]}`
      : label;
  return course ? `${what} in ${course}` : what;
}

/** When the student last worked on it: practised, edited, or else when it was made. */
function whenText(artifact: ArtifactSummary, now: Date) {
  const ago = (at: string) => timeAgo(new Date(at), now, "long");
  if (artifact.lastPractisedAt) return `${ago(artifact.lastPractisedAt)} geübt`;
  if (artifact.updatedAt && (artifact.version ?? 1) > 1)
    return `${ago(artifact.updatedAt)} bearbeitet`;
  return `${ago(artifact.createdAt)} erstellt`;
}

/** The one badge a card shows: where its making stands first, then whether it is new, then whether it is shaky. */
function badgeOf(artifact: ArtifactSummary) {
  if (artifact.status === "making")
    return {
      text: "Wird erstellt",
      className: "bg-primary-100 text-primary-700",
    };
  if (artifact.status === "failed")
    return {
      text: "Fehlgeschlagen",
      className: "bg-destructive-50 text-destructive-700",
    };
  if (artifact.withdrawn)
    return { text: "Quelle gelöscht", className: "bg-base-100 text-base-600" };
  if (!artifact.openedAt)
    return { text: "Neu", className: "bg-success-50 text-success-800" };
  if (artifact.shaky)
    return { text: "Unsicher", className: "bg-warning-50 text-warning-700" };
  return null;
}

/** One Artifact, linking to where the student studies it once it is made. */
export function ArtifactCard({
  artifact,
  course,
  now,
}: {
  artifact: ArtifactSummary;
  /** Its Course's title, once known. */
  course: string | undefined;
  now: Date;
}) {
  const { label, icon: Icon, color } = kinds[artifact.kind];
  const badge = badgeOf(artifact);
  const title = artifact.title ?? label;
  const making = artifact.status === "making";
  return (
    <li
      className={`flex flex-col rounded-lg bg-base-100 px-px ${artifact.withdrawn ? "opacity-60" : ""}`}
    >
      <div
        className={`relative flex flex-col rounded-lg bg-white p-5 shadow-xs outline outline-base-700/15 ${
          making
            ? ""
            : "hover:bg-base-50 has-focus-visible:outline-2 has-focus-visible:outline-primary-500"
        }`}
      >
        <span className="flex h-5 items-center justify-between">
          <Icon aria-label={label} className={`size-5 shrink-0 ${color}`} />
          {badge && (
            <span
              className={`rounded-sm px-1.5 text-xs leading-5 font-medium ${badge.className}`}
            >
              {badge.text}
            </span>
          )}
        </span>
        <span
          className={`mt-4 truncate text-sm leading-5 font-medium text-base-800 ${making ? "shimmer" : ""}`}
        >
          {making ? (
            title
          ) : (
            <Link
              href={`/artifacts/${encodeURIComponent(artifact.id)}`}
              className="outline-hidden"
            >
              {title}
              {/* Stretches the link over the card, so a screen reader reads only the title. */}
              <span aria-hidden="true" className="absolute inset-0" />
            </Link>
          )}
        </span>
        <span
          className={`mt-0.5 truncate text-sm leading-5 text-base-500 ${making ? "shimmer" : ""}`}
        >
          {whatText(artifact, course)}
        </span>
      </div>
      <span className="flex h-6 items-center justify-end px-5 text-xs font-medium text-base-700">
        {whenText(artifact, now)}
      </span>
    </li>
  );
}
