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
    badge: "bg-primary-100 text-primary-600",
    Icon: CheckCheck,
  },
  {
    mode: "automatic",
    label: "Automatisch",
    badge: "bg-[oklch(96.7%_0.067_122.3)] text-[oklch(53.2%_0.157_131.6)]",
    Icon: ShieldCheck,
  },
  {
    mode: "ask",
    label: "Nachfragen",
    badge: "bg-[oklch(96.2%_0.059_95.6)] text-[oklch(66.6%_0.179_58.3)]",
    Icon: MessageCircleQuestion,
  },
];

export const modeOf = (mode: ApprovalMode) =>
  modes.find((each) => each.mode === mode)!;
