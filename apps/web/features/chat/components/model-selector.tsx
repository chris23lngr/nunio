"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@nunio/ui/components/popover/popover";
import { Brain, Check, ChevronDown } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { ChatModel } from "../api/model-queries";

function ModelLogo({
  provider,
  trigger = false,
}: {
  provider: string | undefined;
  trigger?: boolean;
}) {
  const src =
    provider === "Anthropic"
      ? "/icons/claude.svg"
      : provider === "OpenAI"
        ? "/icons/openai.svg"
        : undefined;
  return src ? (
    <Image
      src={src}
      width={16}
      height={16}
      alt=""
      className={`w-auto shrink-0 ${trigger ? "h-5" : "h-4"}`}
    />
  ) : (
    <Brain aria-hidden="true" className="size-4 shrink-0 text-primary-500" />
  );
}

const tiers = { low: "niedrig", medium: "mittel", high: "hoch" };
const multiplier = new Intl.NumberFormat("de-DE", {
  maximumSignificantDigits: 2,
});

/** What a model uses up, relative to the default model `standard`. */
function costLine(model: ChatModel, standard: ChatModel | undefined) {
  if (model.key === standard?.key) return "Verbrauch: Standard";
  if (!standard) return `Verbrauch: ${tiers[model.cost.tier]}`;
  return `Verbrauch: ${tiers[model.cost.tier]} · etwa ${multiplier.format(model.cost.relativeToDefault)}× ${standard.name}`;
}

function dataLine({ dataHandling }: ChatModel) {
  return `Über ${dataHandling.provider} · ${dataHandling.upstream.join(", ")} · keine Datenspeicherung`;
}

export function ModelSelector({
  models,
  value,
  defaultModel,
  onValueChange,
}: {
  models: ChatModel[];
  value: string;
  /** Key of the default model, which costs are stated against. */
  defaultModel: string | null;
  onValueChange: (key: string) => void;
}) {
  const current = models.find(({ key }) => key === value);
  const standard = models.find(({ key }) => key === defaultModel);
  const [card, setCard] = useState<{ model: ChatModel; row: HTMLElement }>();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu onOpenChange={(menuOpen) => !menuOpen && setOpen(false)}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" />}
          aria-label={`Modell: ${current?.name}`}
        >
          <ModelLogo provider={current?.provider} trigger />
          {current?.name}
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[182px]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Modelle</DropdownMenuLabel>
            {models.map((model) => (
              <DropdownMenuItem
                key={model.key}
                aria-current={model.key === value || undefined}
                onClick={() => onValueChange(model.key)}
                // Base UI focuses the highlighted row on hover and arrow keys.
                onFocus={(event) => {
                  setCard({ model, row: event.currentTarget });
                  setOpen(true);
                }}
              >
                <ModelLogo provider={model.provider} />
                {model.name}
                {model.key === value && (
                  <Check className="ml-auto text-base-600" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverContent
          anchor={card?.row}
          side="right"
          align="start"
          sideOffset={8}
          // Centers the card title on the row text.
          alignOffset={-10}
          initialFocus={false}
          finalFocus={false}
        >
          <PopoverHeader>
            <PopoverTitle>
              {card && <ModelLogo provider={card.model.provider} />}
              <span>
                <span className="font-normal text-base-500">
                  {card?.model.provider} /
                </span>{" "}
                {card?.model.name}
              </span>
            </PopoverTitle>
            <PopoverDescription>{card?.model.description}</PopoverDescription>
            {/* Plain paragraphs: Base UI links only one description to the card. */}
            {card && (
              <p className="text-base-500 text-xs leading-4">
                {costLine(card.model, standard)}
              </p>
            )}
            {card && (
              <p className="text-base-500 text-xs leading-4">
                {dataLine(card.model)}
              </p>
            )}
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </>
  );
}
