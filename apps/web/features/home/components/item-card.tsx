import { cn } from "@nunio/ui";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useId } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { CourseDot } from "@/features/shared/components/course-dot";

/** A Home section's heading, with how many items it holds or a link to everything of its kind. */
export function SectionHeading({
  id,
  title,
  count,
  link,
}: {
  id: string;
  title: string;
  count?: number;
  link?: { href: string; label: string };
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-2",
        link && "justify-between",
      )}
    >
      <h2 id={id} className="text-lg font-semibold text-base-900">
        {title}
      </h2>
      {count !== undefined && (
        <span className="text-sm font-medium text-base-600">{count}</span>
      )}
      {link && (
        <Link
          href={link.href}
          className="text-sm font-medium text-primary-700 hover:underline"
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** A left-column section: its heading and one card of rows. */
export function ItemSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeading id={id} title={title} count={count} />
      <ul className="flex flex-col rounded-xl bg-white shadow-[0_1px_3px_#0000000f,0_1px_2px_#0000000a] outline-1 outline-base-700/14">
        {children}
      </ul>
    </section>
  );
}

const tones = {
  base: "bg-base-100 text-base-700",
  warning: "bg-warning-50 text-warning-700",
  shortfall: "bg-warning-50 text-warning-700 outline-1 outline-warning-600/25",
};

/** The color of the Course a Home item names by its title, when it is one of the student's Courses. */
function CourseMark({
  apiOrigin,
  course,
}: {
  apiOrigin: string;
  course: string;
}) {
  const courses = useQuery(courseListQuery(apiOrigin)).data?.courses ?? [];
  const found = courses.find((c) => c.title === course);
  return found ? <CourseDot color={found.color} /> : null;
}

/** The line under a title: the Course's color, then what it is about. */
export function MetaLine({
  apiOrigin,
  course,
  children,
  className,
}: {
  apiOrigin: string;
  course: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-sm text-base-600",
        className,
      )}
    >
      {course && <CourseMark apiOrigin={apiOrigin} course={course} />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** One row of a Home card: an icon, a title, what it is about, and what the student can do. */
export function ItemRow({
  icon: Icon,
  tone = "base",
  title,
  meta,
  children,
}: {
  icon: LucideIcon;
  tone?: keyof typeof tones;
  title: string;
  meta: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      aria-label={title}
      className="flex items-start gap-4 border-base-700/10 p-5 not-first:border-t"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          tones[tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-base-900">{title}</h3>
          {meta}
        </div>
        {children}
      </div>
    </li>
  );
}

/** Body copy of a row. */
export function RowText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-base-700">{children}</p>;
}

/** The buttons or links at the foot of a row. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
