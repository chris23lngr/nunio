/** The Connect dialog's data note: where the vendor processes data, then nunio's two fixed lines (#266). */
export function DataNote({ dataNote }: { dataNote: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs leading-4 text-base-600">
      <p>{dataNote}.</p>
      <p>
        Was nunio liest, geht ohne Speicherung beim Anbieter an das KI-Modell.
      </p>
      <p>
        nunio speichert es verschlüsselt, bis du den Chat löschst oder die
        Verbindung trennst.
      </p>
    </div>
  );
}
