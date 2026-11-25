import { cn } from "@nunio/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useId } from "react";
import { kinds } from "@/features/artifacts/artifact-kinds";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { CourseDot } from "@/features/shared/components/course-dot";
import type { Home } from "../api/home-queries";
import { SectionHeading } from "./item-card";

const rowLine = "border-b border-base-700/10";

/** A right-column list's empty state. */
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className={cn("px-2 py-3 text-sm text-base-600", rowLine)}>{children}</p>
  );
}

/** Artifacts nunio made that the student has not opened yet. */
export function ReadySection({
  apiOrigin,
  artifacts,
}: {
  apiOrigin: string;
  artifacts: Home["artifacts"];
}) {
  const id = useId();
  const courses = useQuery(courseListQuery(apiOrigin)).data?.courses ?? [];
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeading
        id={id}
        title="Bereit für dich"
        link={{ href: "/artifacts", label: "Alles Vorbereitete" }}
      />
      <div className="border-t border-base-700/10">
        {artifacts.length ? (
          <ul>
            {artifacts.map((artifact) => {
              const kind = kinds[artifact.kind];
              const course = courses.find((c) => c.id === artifact.courseId);
              const count =
                kind.counted && artifact.count !== null
                  ? `${artifact.count} ${kind.counted[artifact.count === 1 ? 0 : 1]}`
                  : null;
              return (
                <li key={artifact.id} className={rowLine}>
                  <Link
                    href={`/artifacts/${artifact.id}`}
                    className="flex items-center gap-3 px-2 py-3 hover:bg-base-50"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-base-100 text-base-700"
                    >
                      <kind.icon className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-semibold text-base-900">
                        {artifact.title ?? kind.label}
                      </span>
                      <span className="flex items-start gap-1.5 text-xs text-base-600">
                        {course && (
                          <span className="mt-1 flex">
                            <CourseDot color={course.color} />
                          </span>
                        )}
                        {[course?.title, kind.label, count]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-base-500"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Noch nichts Neues von nunio.</Empty>
        )}
      </div>
    </section>
  );
}

const agentBadges = {
  approval: {
    label: "Freigabe benötigt",
    className: "bg-warning-50 text-warning-700",
  },
  active: { label: "Aktiv", className: "bg-primary-50 text-primary-700" },
  paused: { label: "Pausiert", className: "bg-base-100 text-base-600" },
  ended: { label: "Beendet", className: "bg-base-100 text-base-600" },
};

function Badge({ badge }: { badge: keyof typeof agentBadges }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-1.5 text-xs/5 font-medium",
        agentBadges[badge].className,
      )}
    >
      {agentBadges[badge].label}
    </span>
  );
}

/** What is still running, and what the student delegated to nunio. */
export function BackgroundSection({
  ongoing,
  agentWork,
}: {
  ongoing: Home["ongoing"];
  agentWork: Home["agentWork"];
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-semibold text-base-900">
        Im Hintergrund
      </h2>
      <div className="border-t border-base-700/10">
        {ongoing.length ? (
          <ul className={cn("flex flex-col gap-3 px-2 py-3", rowLine)}>
            {ongoing.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 text-sm text-base-700"
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 shrink-0 text-primary-600 motion-safe:animate-spin"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-base-900">
                    {item.title}
                  </span>{" "}
                  {item.activity === "processing"
                    ? "wird verarbeitet"
                    : "wird fürs Prüfen gelesen"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Gerade läuft nichts.</Empty>
        )}
        <div className={cn("flex flex-col gap-1 px-2 pt-4 pb-3", rowLine)}>
          <div className="flex items-center justify-between pb-1">
            <h3 className="text-xs font-medium text-base-500">
              An nunio delegiert
            </h3>
            {agentWork.length > 0 && (
              <Link
                href="/agents"
                className="text-[13px]/4 font-medium text-primary-700 hover:underline"
              >
                Agenten
              </Link>
            )}
          </div>
          {agentWork.length ? (
            <ul>
              {agentWork.map((item) =>
                item.kind === "approval" ? (
                  <li
                    key={item.actionId}
                    className="flex items-center gap-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 text-sm font-medium text-base-900">
                      {item.title}
                    </span>
                    <Badge badge="approval" />
                  </li>
                ) : (
                  <li key={item.id} className="flex items-center gap-2 py-1.5">
                    <Link
                      href={`/agents/${item.id}`}
                      className="min-w-0 flex-1 text-sm font-medium text-base-900 hover:underline"
                    >
                      {item.name}
                    </Link>
                    <Badge badge={item.state} />
                  </li>
                ),
              )}
            </ul>
          ) : (
            <>
              <p className="pt-1 text-sm text-base-700">
                Noch nichts. Richte einen Agenten ein, dann arbeitet nunio für
                dich an deinen Kursen weiter.
              </p>
              <Link
                href="/agents"
                className="w-fit pt-1 text-sm font-medium text-primary-700 hover:underline"
              >
                Agent einrichten
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
