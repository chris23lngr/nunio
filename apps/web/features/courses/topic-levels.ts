import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
} from "lucide-react";
import type { TopicLevel } from "./api/course-queries";

/** Each Understanding Level as the student chooses and sees it, in the order offered (ADR-0023). */
export const topicLevels: {
  level: TopicLevel;
  label: string;
  icon: LucideIcon;
  /** Paper's base, destructive, warning and success 500. */
  color: string;
}[] = [
  {
    level: "not_studied",
    label: "Nicht gelernt",
    icon: CircleDashed,
    color: "text-base-500",
  },
  {
    level: "weak",
    label: "Schwachpunkt",
    icon: CircleAlert,
    color: "text-destructive-500",
  },
  {
    level: "shaky",
    label: "Unsicher",
    icon: CircleSlash,
    color: "text-warning-500",
  },
  {
    level: "solid",
    label: "Sicher",
    icon: CircleCheck,
    color: "text-success-500",
  },
];

export const levelOf = (level: TopicLevel) =>
  topicLevels.find((l) => l.level === level)!;
