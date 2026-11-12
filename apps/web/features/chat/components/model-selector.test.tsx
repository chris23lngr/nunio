import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { ChatModel } from "../api/model-queries";
import { ModelSelector } from "./model-selector";

const dataHandling: ChatModel["dataHandling"] = {
  provider: "OpenRouter",
  upstream: ["Amazon Bedrock", "Google"],
  routing: "international",
  zeroRetention: true,
};
const models: ChatModel[] = [
  {
    key: "opus",
    name: "Opus 5.5",
    provider: "Anthropic",
    description: "Das leistungsstärkste Modell für komplexe Aufgaben.",
    dataHandling,
    cost: { relativeToDefault: 2, tier: "high" },
  },
  {
    key: "sonnet",
    name: "Sonnet 5",
    provider: "Anthropic",
    description: "Ausgewogen zwischen Qualität und Geschwindigkeit.",
    dataHandling: { ...dataHandling, upstream: ["Anthropic"] },
    cost: { relativeToDefault: 1, tier: "medium" },
  },
  {
    key: "haiku",
    name: "Haiku 5",
    provider: "Anthropic",
    description: "Schnell und sparsam.",
    dataHandling,
    cost: { relativeToDefault: 0.0512, tier: "low" },
  },
];

function mount(props: Partial<Parameters<typeof ModelSelector>[0]> = {}) {
  const selected: string[] = [];
  const view = render(
    <ModelSelector
      models={models}
      value="sonnet"
      defaultModel="sonnet"
      onValueChange={(key) => selected.push(key)}
      {...props}
    />,
  );
  return { selected, ...view };
}

test("trigger shows the current model", () => {
  mount({ value: "opus" });
  const trigger = screen.getByRole("button", { name: "Modell: Opus 5.5" });
  expect(trigger.textContent).toBe("Opus 5.5");
});

test("menu lists every model and marks only the current one", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  const group = await screen.findByRole("group", { name: "Modelle" });
  const rows = within(group).getAllByRole("menuitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "Opus 5.5",
    "Sonnet 5",
    "Haiku 5",
  ]);
  expect(rows.map((row) => row.getAttribute("aria-current"))).toEqual([
    null,
    "true",
    null,
  ]);
});

test("highlighting a row shows one info card for that model", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  await user.hover(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  const card = await screen.findByRole("dialog", {
    name: "Anthropic / Opus 5.5",
  });
  expect(card.textContent).toContain(
    "Das leistungsstärkste Modell für komplexe Aufgaben.",
  );

  await user.keyboard("{ArrowDown}");
  await screen.findByRole("dialog", { name: "Anthropic / Sonnet 5" });
  expect(screen.getAllByRole("dialog").length).toBe(1);
  expect(screen.getByRole("dialog").textContent).toContain(
    "Ausgewogen zwischen Qualität und Geschwindigkeit.",
  );
});

test("the card states a model's cost relative to the default model", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  const card = async (name: string) => {
    await user.hover(await screen.findByRole("menuitem", { name }));
    return screen.findByRole("dialog", { name: `Anthropic / ${name}` });
  };

  expect(
    within(await card("Opus 5.5")).getByText(
      "Verbrauch: hoch · etwa 2× Sonnet 5",
    ),
  ).toBeTruthy();
  expect(
    within(await card("Sonnet 5")).getByText("Verbrauch: Standard"),
  ).toBeTruthy();
  expect(
    within(await card("Haiku 5")).getByText(
      "Verbrauch: niedrig · etwa 0,051× Sonnet 5",
    ),
  ).toBeTruthy();
});

test("the card says how a model's data is handled", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  await user.hover(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  const card = await screen.findByRole("dialog", {
    name: "Anthropic / Opus 5.5",
  });
  expect(
    within(card).getByText(
      "Über OpenRouter · Amazon Bedrock, Google · keine Datenspeicherung",
    ),
  ).toBeTruthy();
});

test("Escape closes the menu and its card", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  await user.hover(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBe(null));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
});

test("choosing a model reports its key and closes the card", async () => {
  const user = userEvent.setup();
  const { selected } = mount();
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  await user.click(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
  expect(selected).toEqual(["opus"]);
});

test("trigger, rows and card show the decorative Claude logo at 16px", async () => {
  const user = userEvent.setup();
  const { container } = mount();
  const logo = (element: Element) => {
    const img = element.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/\/icons\/claude\.svg$/);
    expect(img?.getAttribute("height")).toBe("16");
    expect(img?.getAttribute("alt")).toBe("");
  };
  logo(container);
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5" }));
  for (const row of await screen.findAllByRole("menuitem")) logo(row);
  await user.hover(screen.getByRole("menuitem", { name: "Opus 5.5" }));
  logo(await screen.findByRole("dialog"));
});
