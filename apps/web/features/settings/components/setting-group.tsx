import type { ReactNode } from "react";
import { useId } from "react";

export function SettingGroup({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="@container min-w-0 overflow-hidden rounded-xl bg-white shadow-sm outline-1 outline-base-700/15"
    >
      <header className="px-6 py-4">
        <h2
          id={titleId}
          className="text-lg leading-7 font-medium text-base-800"
        >
          {title}
        </h2>
      </header>
      <div className="px-6 pt-2 pb-4">{children}</div>
      {footer && (
        <footer className="flex flex-wrap justify-end gap-4 border-t border-base-200 bg-base-50 px-6 py-4">
          {footer}
        </footer>
      )}
    </section>
  );
}
