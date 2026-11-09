import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-base-50 px-6 py-12 sm:px-8 sm:py-32">
      <div className="w-full max-w-96 font-sans text-base-800">{children}</div>
    </main>
  );
}
