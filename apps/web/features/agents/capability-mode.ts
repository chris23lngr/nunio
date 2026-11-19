import { CheckCheck, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import type { ApprovalMode } from "./api/agent-queries";

/** The approval modes in the order the student is offered them, each with its name, badge and icon. */
export const modes: {
  mode: ApprovalMode;
  label: string;
  badge: string;
  Icon: typeof CheckCheck;
}[] = [
  {
    mode: "always",
    label: "Immer erlaubt",
    badge: "bg-primary-50 text-primary-700",
    Icon: CheckCheck,
  },
  {
    mode: "automatic",
    label: "Automatisch",
    badge: "bg-success-50 text-success-800",
    Icon: ShieldCheck,
  },
  {
    mode: "ask",
    label: "Nachfragen",
    badge: "bg-warning-50 text-warning-800",
    Icon: MessageCircleQuestion,
  },
];

export const modeOf = (mode: ApprovalMode) =>
  modes.find((each) => each.mode === mode)!;
