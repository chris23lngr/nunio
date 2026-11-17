# Leitfaden: Topics labeln

> **Vom Gründer freigegeben am 2026-11-17.** Hintergrund: [ADR-0025](../../../../../docs/adr/0025-topics-are-coarse-units-the-student-practices.md). Ersetzt die Fassung vom 2026-11-12, die feine Konzepte pro Deck verlangte.

Pro Kurs eine Datei `<kurs-id>.md`. Blind labeln: Wer labelt, ob Gründer oder Modell, sieht vorher keine Extraktion und keine Labels anderer. Labeln Modelle, führt der Gründer ihre Ergebnisse zusammen und prüft jede Zeile gegen die Prüffrage. Eine Zeile pro Topic, auch wenn es in mehreren Dokumenten vorkommt.

## Was ist ein Topic?

Ein Topic ist ein Teil des Kurses, den Studierende als Einheit üben und in dem sie geprüft werden, etwa so groß wie ein Abschnitt einer Vorlesung (GLOSSARY: _Topic_). Prüffrage: **Würde ich mich zu diesem Thema selbst einschätzen und dazu eine eigene Übungsaufgabe erwarten?** Dann ist es ein Topic. Ein Begriff innerhalb eines solchen Themas ist keins.

Kein Topic sind:

- **Organisatorisches:** Ablauf, Termine, Bewertung, Anwesenheit, Sprechstunden, Literatur, Software-Installation. Solche Seiten bekommen keine Zeilen.
- **Gliederung ohne Inhalt:** „Einleitung“, „Zusammenfassung“, „Ausblick“.
- **Nebenbemerkungen:** Geschichte, Motivation, Anekdoten, die im Kurs nicht wieder vorkommen.
- **Beispiele um ihrer selbst willen:** ein konkreter Datensatz, eine Beispielschaltung mit Bauteilwerten.

Die Lerninhalte, die eine Modulbeschreibung oder ein Syllabus aufführt, sind Topics, wenn sie diese Größe haben.

## Granularität

| Zu grob            | Richtig                | Zu fein               |
| ------------------ | ---------------------- | --------------------- |
| Signalverarbeitung | Fourier-Transformation | Fourier-Koeffizient   |
| Deep Learning      | Backpropagation        | Lernrate              |
| Digitaltechnik     | Flip-Flops             | Zustand bei S = R = 1 |

Im Zweifel den Namen der Überschrift oder des Eintrags im Inhaltsverzeichnis nehmen, der den Teil abdeckt.

## Dokumente

Die erste Tabelle listet die Dokumente des Kurses in der Reihenfolge, in der Studierende sie hochladen würden:

- **ID:** kurzer Name ohne Leerzeichen, z. B. `einfuehrung` oder `vl-03`. Nicht den Dateinamen.
- **SHA-256:** Hash der PDF-Datei (`shasum -a 256 datei.pdf`). Die PDFs selbst bleiben lokal und kommen nie in git.
- **Art:** `organisation` (Ablauf, Einführung ohne Stoff; hier erwarten wir keine Topics), `modul` (Modulbeschreibung oder Syllabus) oder `folien` (Vorlesungsfolien oder Skript).

## Spalten der Topic-Tabelle

- **Thema:** der Name, wie die Dokumente ihn nennen.
- **Aliase:** weitere Namen, getrennt durch `;`: Schreibvarianten, Deutsch/Englisch, Singular/Plural, gängige Abkürzungen. Keine leeren Einträge, keine Oberbegriffe, kein `|` in Namen.
- **Fundstellen:** Dokument-ID und Seiten, getrennt durch `;`, z. B. `modul 2; vl-01 4–9`. Seite 1 ist die erste Seite der Datei.
- **optional:** `ja` für Grenzfälle, die weder fehlen noch stören sollen, falls ein Modell sie findet. Sonst leer.

## Beispiel

```
Kurs: Signale und Systeme

| ID | SHA-256 | Art |
| --- | --- | --- |
| einfuehrung | 3f2a… | organisation |
| modul | 9c1d… | modul |
| vl-01 | a07b… | folien |

| Thema | Aliase | Fundstellen | optional |
| --- | --- | --- | --- |
| Fourier-Transformation | Fouriertransformation; Fourier transform | modul 2; vl-01 4–9 | |
| Abtasttheorem | Nyquist-Shannon-Abtasttheorem; Sampling theorem | modul 2; vl-01 12–15 | |
| Fensterfunktionen | Fensterung | vl-01 16 | ja |
```

Tabellenköpfe nicht ändern. Fehler beim Einlesen nennen die Zeile.
