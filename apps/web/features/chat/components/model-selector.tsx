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
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

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
  // Sparkles stands in for a provider logo until models carry one.
  return (
    <>
      <DropdownMenu onOpenChange={(menuOpen) => !menuOpen && setOpen(false)}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" />}
          aria-label={`Modell: ${current?.name}`}
        >
          <Sparkles className="size-5" />
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
                <Sparkles />
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
              <Sparkles />
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
