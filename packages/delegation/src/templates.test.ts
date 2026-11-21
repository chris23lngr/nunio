import { describe, expect, it } from "vitest";
import { capabilities, checkCapabilities } from "./capabilities.js";
import { agentTemplates, isTemplateId, templateIds } from "./templates.js";

describe("agentTemplates", () => {
  it("ships exactly the three curated v1 Templates from #147, setting no Model or Budget", () => {
    expect(templateIds).toEqual([
      "prepareExam",
      "organizeCourse",
      "createBriefings",
    ]);

    expect(agentTemplates.prepareExam).toEqual({
      name: "Klausur vorbereiten",
      description: "Plant deine Vorbereitung bis zum Prüfungstag.",
      emoji: "🎯",
      instructions: [
        "Bereite mich auf die nächste Klausur in meinen Kursen vor.",
        "Verteile die Themen bis zum Prüfungstag auf realistische Lernblöcke. Priorisiere Themen, bei denen ich noch unsicher bin, und plane Wiederholungen ein.",
        "Prüfe bei jedem Start meinen Fortschritt und passe den Plan an. Lass meine selbst geplanten Lernblöcke unverändert.",
      ].join("\n\n"),
      trigger: { rhythm: "daily", minute: 6 * 60 },
      courses: "none",
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "moveOwnStudyBlocks", mode: "automatic" },
        { id: "removeOwnStudyBlocks", mode: "automatic" },
        { id: "notifyStudent", mode: null },
      ],
      createdOn: "2026-11-19",
    });

    expect(agentTemplates.organizeCourse).toEqual({
      name: "Kurs organisieren",
      description: "Behält Termine, Themen und deinen Lernplan im Blick.",
      emoji: "📚",
      instructions: [
        "Halte meine Kurse organisiert.",
        "Achte auf neue Termine, Abgaben und Themen. Lege Aufgaben für Abgaben und Termine an, die Vorbereitung brauchen, und plane genug Lernzeit vor ihren Fristen ein.",
        "Wenn etwas nicht mehr in meine Woche passt, sag mir Bescheid.",
      ].join("\n\n"),
      trigger: { rhythm: "daily", minute: 6 * 60 },
      courses: "none",
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "moveOwnStudyBlocks", mode: "automatic" },
        { id: "removeOwnStudyBlocks", mode: "automatic" },
        { id: "createTasks", mode: "ask" },
        { id: "notifyStudent", mode: null },
      ],
      createdOn: "2026-11-19",
    });

    expect(agentTemplates.createBriefings).toEqual({
      name: "Briefings erstellen",
      description: "Gibt dir täglich Updates über deinen Lernfortschritt.",
      emoji: "📧",
      instructions:
        "Fasse jeden Morgen kurz zusammen, was heute für mich ansteht: offene Freigaben, neue Nachrichten, fertiges Lernmaterial und was in meinem Plan als Nächstes kommt.",
      trigger: { rhythm: "daily", minute: 7 * 60 },
      courses: "all_active",
      capabilities: [{ id: "createBriefing", mode: null }],
      createdOn: "2026-11-19",
    });

    for (const id of templateIds) {
      const template = agentTemplates[id];
      expect("modelKey" in template).toBe(false);
      expect("budgetMicroUsd" in template).toBe(false);
      expect(template.createdOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it.each(templateIds)(
    "Template %s holds only valid Capabilities and allowed modes from the capability set in code",
    (id) => {
      const template = agentTemplates[id];
      const checked = checkCapabilities([...template.capabilities]);
      expect(checked).toEqual(template.capabilities);

      for (const capability of template.capabilities) {
        expect(Object.hasOwn(capabilities, capability.id)).toBe(true);
        const allowed: readonly string[] = capabilities[capability.id].modes;
        if (allowed.length === 0) {
          expect(capability.mode).toBeNull();
        } else {
          expect(capability.mode).not.toBeNull();
          expect(allowed).toContain(capability.mode);
        }
      }
    },
  );

  it("recognises only curated Template IDs", () => {
    expect(isTemplateId("prepareExam")).toBe(true);
    expect(isTemplateId("organizeCourse")).toBe(true);
    expect(isTemplateId("createBriefings")).toBe(true);
    expect(isTemplateId("unknown")).toBe(false);
    expect(isTemplateId("toString")).toBe(false);
  });
});
