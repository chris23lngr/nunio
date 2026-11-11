import { Bell, ShieldCheck } from "lucide-react";
import Link from "next/link";

export function SettingsNavigation({
  active = "security",
}: {
  active?: "security" | "notifications";
}) {
  return (
    <nav aria-label="Einstellungen" className="w-full shrink-0 xl:w-64">
      {[
        { key: "security", label: "Sicherheit", Icon: ShieldCheck },
        { key: "notifications", label: "Benachrichtigungen", Icon: Bell },
      ].map(({ key, label, Icon }) => (
        <Link
          key={key}
          href={`/settings/${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-base leading-5 font-medium hover:bg-base-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500 ${active === key ? "text-primary-600" : "text-base-800"}`}
        >
          <Icon
            aria-hidden="true"
            className={`size-4 shrink-0 ${active === key ? "text-primary-500" : "text-base-500"}`}
          />
          {label}
        </Link>
      ))}
    </nav>
  );
}
