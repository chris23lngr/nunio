/** Why a Paused Agent is Paused, as its header and its row say it, such as "Pausiert: Budget aufgebraucht". */
const pausedLines: Record<string, string> = {
  student: "Von dir pausiert",
  budget: "Pausiert: Budget aufgebraucht",
  course_archived: "Pausiert: Alle Kurse archiviert",
  no_course: "Pausiert: Kein Kurs mehr",
  conversion: "Übernommen: prüfen und fortsetzen",
};
export const pausedLine = (pausedBy: string | null) =>
  (pausedBy && pausedLines[pausedBy]) || "Pausiert";
