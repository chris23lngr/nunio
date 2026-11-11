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
import { Check, ChevronDown } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

// All models are Anthropic's. The viewBox is 256×257, so 16px tall is ~16px wide.
const logo = (
  <Image
    src="/icons/claude.svg"
    width={16}
    height={16}
    alt=""
    className="shrink-0"
  />
);

type Model = {
  id: string;
  name: string;
  provider: string;
  description: string;
};

export function ModelSelector({
  models,
  value,
}: {
  models: Model[];
  value: string;
}) {
  const current = models.find(({ id }) => id === value);
  const [card, setCard] = useState<{ model: Model; row: HTMLElement }>();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu onOpenChange={(menuOpen) => !menuOpen && setOpen(false)}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" />}
          aria-label={`Modell: ${current?.name}`}
        >
          {logo}
          {current?.name}
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[182px]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Modelle</DropdownMenuLabel>
            {models.map((model) => (
              <DropdownMenuItem
                key={model.id}
                aria-current={model.id === value || undefined}
                // Base UI focuses the highlighted row on hover and arrow keys.
                onFocus={(event) => {
                  setCard({ model, row: event.currentTarget });
                  setOpen(true);
                }}
              >
                {logo}
                {model.name}
                {model.id === value && (
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
              {logo}
              <span>
                <span className="font-normal text-base-500">
                  {card?.model.provider} /
                </span>{" "}
                {card?.model.name}
              </span>
            </PopoverTitle>
            <PopoverDescription>{card?.model.description}</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </>
  );
}
