import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import { BookDashed } from "lucide-react";
import Link from "next/link";

/** Why the grid is empty, and the way forward: Sources to upload, proposals to accept, or a Course to create. */
export function EmptyState({
  kind,
  semester,
  onCreate,
}: {
  kind: "none" | "proposals" | "semester";
  semester: string;
  onCreate: () => void;
}) {
  const copy = {
    none: {
      title: "Noch keine Kurse",
      text: "Lade Quellen wie einen Modulplan oder ein Übungsblatt hoch, dann erkennt nunio deine Kurse. Du kannst einen Kurs auch selbst anlegen.",
    },
    proposals: {
      title: "Nimm deine Kurse an",
      text: "nunio hat oben Kurse aus deinen Quellen erkannt. Nimm an, was du belegst, oder lege einen Kurs selbst an.",
    },
    semester: {
      title: `Keine Kurse in ${semester}`,
      text: "Lege einen Kurs für dieses Semester an, oder wähle oben ein anderes Semester.",
    },
  }[kind];
  return (
    <div className="mx-auto mt-24 flex max-w-sm flex-col items-start gap-4">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-md border border-dashed border-base-300 text-base-500"
      >
        <BookDashed className="size-5" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-medium text-base-800">{copy.title}</h2>
        <p className="text-sm leading-6 text-base-600">{copy.text}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {kind === "none" && (
          <Link href="/" className={buttonVariants()}>
            Quellen hochladen
          </Link>
        )}
        <Button
          variant={kind === "none" ? "outline" : "primary"}
          onClick={onCreate}
        >
          Kurs erstellen
        </Button>
      </div>
    </div>
  );
}
