# Leitfaden: Topics labeln

> **Entwurf, wartet auf Freigabe durch den Gründer.** Hintergrund: [docs/design/topic-quality.md](../../../../../docs/design/topic-quality.md).

Pro Deck eine Datei `<deck-id>.md`. Blind labeln: vorher keine Ausgabe von Modellen oder Agenten ansehen. Eine Zeile pro Konzept.

## Was ist ein Topic?

Ein Topic ist ein Stück Kursinhalt, das Studierende verstehen sollen (GLOSSARY: _Topic_). Prüffrage: **Braucht man das Konzept, um eine Klausurfrage zu beantworten?** Dann ist es ein Topic.

Kein Topic sind:

- **Gliederung und Überschriften:** „Einleitung“, „Zusammenfassung“, „Kapitel 3“, „Ausblick“.
- **Organisatorisches:** Sprechstunden, Prüfungsmodus, Literatur, Software-Installation, Zeitplan.
- **Beispiele um ihrer selbst willen:** ein konkreter Datensatz, eine Beispielschaltung mit Bauteilwerten, eine Firma. Das Konzept, das ein Beispiel zeigt, ist ein Topic, das Beispiel selbst nicht.

## Granularität

So fein, dass man dazu eine eigene Klausurfrage stellen kann, und so grob, dass es kein Einzelfall ist.

| Zu grob            | Richtig         | Zu fein                           |
| ------------------ | --------------- | --------------------------------- |
| Signalverarbeitung | Quantisierung   | Quantisierungsstufe 3             |
| Deep Learning      | Backpropagation | Gradient von Gewicht w₁₂          |
| Digitaltechnik     | RS-Flip-Flop    | Zustand bei S = R = 1 im Beispiel |

Zwei Folien zum selben Konzept ergeben eine Zeile; tragen Sie beide Seiten ein.

## Spalten

- **Konzept:** der Name, wie er im Deck steht.
- **Aliase:** weitere Namen, getrennt durch `;`. Schreibvarianten („Bag of Words; bag-of-words“), Deutsch/Englisch („Abtastung; Sampling“), Singular/Plural („Wahrheitstabelle; Wahrheitstabellen“) und gängige Abkürzungen („BPE“). Keine leeren Einträge, keine Oberbegriffe.
- **Seiten:** wo das Konzept behandelt wird, z. B. `3, 5–7`. Die Zählung steht im Kopf jeder Datei: bei einem Ausschnitt ist Seite 1 die erste Ausschnittseite.
- **optional:** `ja`, wenn das Konzept nur gestreift wird und es weder fehlen noch stören soll, falls ein Modell es findet. Sonst leer.
- **nur Abbildung:** `ja`, wenn man das Konzept nur aus einer Abbildung versteht (Schaltbild, Diagramm, Plot, Bild einer Tabelle) und der Folientext es nicht erklärt. Sonst leer.

## Beispiel

```
| Konzept | Aliase | Seiten | optional | nur Abbildung |
| --- | --- | --- | --- | --- |
| Quantisierung | Quantization; Quantisierungen | 3, 5–7 | | |
| RS-Flip-Flop | RS-Latch; SR-Flip-Flop | 4–6 | | ja |
| Logikpegel | Logische Pegel | 12 | ja | |
```

Kurs und Tabellenkopf nicht ändern. Danach `write-labels.ts` ausführen (siehe Design-Dokument); Fehler nennen die Zeile.
