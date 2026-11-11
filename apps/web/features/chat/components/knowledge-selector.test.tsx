import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { Course } from "../api/chat-queries";
import { KnowledgeSelector } from "./knowledge-selector";

const micro: Course = {
  id: "course-1",
  title: "Microeconomics",
  code: "MICD",
};
const stats: Course = {
  id: "course-2",
  title: "Statistik",
  code: null,
};

function mount(props: Partial<Parameters<typeof KnowledgeSelector>[0]> = {}) {
  const toggled: string[] = [];
  render(
    <KnowledgeSelector
      courses={[micro, stats]}
      selected={[]}
      locked={false}
      loading={false}
      onToggle={(id) => toggled.push(id)}
      {...props}
    />,
  );
  return toggled;
}

test("trigger invites to manage knowledge while nothing is selected", () => {
  mount();
  const trigger = screen.getByRole("button", { name: "Wissen verwalten" });
  expect(trigger.textContent).toBe("Wissen verwalten");
});

test("trigger counts selected sources in singular and plural", () => {
  const { rerender } = render(
    <KnowledgeSelector
      courses={[micro, stats]}
      selected={[micro]}
      locked={false}
      loading={false}
      onToggle={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", {
      name: "Wissen verwalten, 1 Quelle ausgewählt",
    }).textContent,
  ).toBe("1 Quelle");
  rerender(
    <KnowledgeSelector
      courses={[micro, stats]}
      selected={[micro, stats]}
      locked={false}
      loading={false}
      onToggle={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", {
      name: "Wissen verwalten, 2 Quellen ausgewählt",
    }).textContent,
  ).toBe("2 Quellen");
});

test("menu lists every course as a switch reflecting the selection", async () => {
  const user = userEvent.setup();
  mount({ selected: [micro] });
  await user.click(screen.getByRole("button", { name: /Wissen verwalten/ }));
  const group = await screen.findByRole("group", { name: "Kurse" });
  const rows = within(group).getAllByRole("menuitemcheckbox");
  expect(rows.map((row) => row.textContent)).toEqual([
    "MicroeconomicsMICD",
    "Statistik",
  ]);
  expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
  ]);
});

test("toggling a course reports its id and keeps the menu open", async () => {
  const user = userEvent.setup();
  const toggled = mount();
  await user.click(screen.getByRole("button", { name: "Wissen verwalten" }));
  await user.click(
    await screen.findByRole("menuitemcheckbox", { name: /Statistik/ }),
  );
  expect(toggled).toEqual(["course-2"]);
  expect(screen.getByRole("menu")).toBeTruthy();
});

test("locked selection disables the trigger but keeps the count", () => {
  mount({ selected: [micro], locked: true });
  const trigger = screen.getByRole("button", {
    name: "Wissen verwalten, 1 Quelle ausgewählt",
  }) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
});

test("menu tells while courses load", async () => {
  const user = userEvent.setup();
  mount({ courses: [], loading: true });
  await user.click(screen.getByRole("button", { name: "Wissen verwalten" }));
  expect((await screen.findByRole("status")).textContent).toBe("Kurse laden …");
});

test("menu shows why courses failed to load", async () => {
  const user = userEvent.setup();
  mount({ courses: [], error: "Kurse konnten nicht geladen werden." });
  await user.click(screen.getByRole("button", { name: "Wissen verwalten" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Kurse konnten nicht geladen werden.",
  );
});

test("menu says when there are no accepted courses", async () => {
  const user = userEvent.setup();
  mount({ courses: [] });
  await user.click(screen.getByRole("button", { name: "Wissen verwalten" }));
  expect(await screen.findByText("Noch keine bestätigten Kurse.")).toBeTruthy();
  expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
});

test("uploading files and managing connectors are not available yet", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Wissen verwalten" }));
  for (const name of ["Datei hochladen", "Konnektoren verwalten"]) {
    const item = await screen.findByRole("menuitem", { name });
    expect(item.getAttribute("aria-disabled")).toBe("true");
  }
});
