import { ShieldCheck } from "lucide-react";
import Link from "next/link";

export function SettingsNavigation() {
  return (
    <nav aria-label="Einstellungen" className="w-full shrink-0 xl:w-64">
      <Link
        href="/settings/security"
        aria-current="page"
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-base leading-5 font-medium text-primary-600 hover:bg-base-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
      >
        <ShieldCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-primary-500"
        />
        Sicherheit
      </Link>
    </nav>
  );
}
