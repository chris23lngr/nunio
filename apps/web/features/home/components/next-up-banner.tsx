import { cn } from "@nunio/ui";
import { buttonVariants } from "@nunio/ui/components/button/button";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Plan } from "@/features/plan/api/plan-queries";
import { planQuery } from "@/features/plan/api/plan-queries";
import { time } from "../home-wording";

/** The Study Block still ahead or under way today that ends first, with its work's title and Course. */
function nextBlock(plan: Plan, now: Date) {
  const endOfDay = new Date(now);
  endOfDay.setHours(24, 0, 0, 0);
  const block = plan.studyBlocks
    .filter((b) => new Date(b.end) > now && new Date(b.start) < endOfDay)
    .sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    )[0];
  if (!block) return null;
  const work =
    block.work.kind === "obligation"
      ? plan.obligations.find((o) => o.id === block.work.id)
      : plan.tasks.find((t) => t.id === block.work.id);
  if (!work) return null;
  const course =
    "kind" in work
      ? work.course
      : (work.course ??
        plan.obligations.find((o) => o.id === work.obligationId)?.course ??
        null);
  return { block, title: work.title, course };
}

/** "in 20 Min.", "in 4 Std.", or that it is under way. */
function until(start: Date, now: Date) {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "läuft gerade";
  if (minutes < 60) return `in ${minutes} Min.`;
  return `in ${Math.round(minutes / 60)} Std.`;
}

/** "Als Nächstes": today's next Study Block from the Plan; nothing when none is left today. */
export function NextUpBanner({ apiOrigin }: { apiOrigin: string }) {
  const plan = useQuery(planQuery(apiOrigin)).data;
  if (!plan) return null;
  const now = new Date();
  const next = nextBlock(plan, now);
  if (!next) return null;
  const { block, title, course } = next;
  return (
    <section
      aria-label="Als Nächstes"
      className="flex items-center gap-5 rounded-xl bg-primary-50 py-4 pr-4 pl-5 outline-1 outline-primary-200"
    >
      <p className="flex w-18 shrink-0 flex-col gap-0.5">
        <span className="text-xl/7 font-semibold text-base-900">
          {time(block.start)}
        </span>
        <span className="text-xs font-medium text-primary-800">
          {until(new Date(block.start), now)}
        </span>
      </p>
      <span aria-hidden="true" className="w-px self-stretch bg-primary-200" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-base font-semibold text-base-900">
          Als Nächstes: Lernblock für „{title}“
        </h2>
        <p className="text-sm text-base-700">
          {course && `${course} · `}
          {time(block.start)}–{time(block.end)}
        </p>
      </div>
      <Link href="/plan" className={cn(buttonVariants(), "h-10 shrink-0 px-4")}>
        Plan öffnen
      </Link>
    </section>
  );
}
