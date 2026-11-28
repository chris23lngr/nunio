"use client";

import { Button } from "@nunio/ui/components/button/button";
import { LoaderCircle } from "lucide-react";
import Image from "next/image";
import type { IntegrationProposal } from "../api/chat-queries";
import type { Decision } from "../proposal-queue";
import { ComposerCard } from "./proposal-card";

const nested = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

/** A value that is not an object or a list, as plain text. */
const scalar = (value: unknown) =>
  value === null || value === undefined ? "–" : String(value);

/**
 * Arguments as label and value, in full: never cut, and never made a link or Markdown (#262), since a value is what
 * the model wrote and may come from content nunio read. Objects and lists are indented beneath their label.
 */
function Arguments({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="flex flex-col gap-2">
      {entries.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-xs text-base-500">{label}</dt>
          <dd className="break-words whitespace-pre-wrap text-base-700">
            {nested(value) ? (
              <div className="mt-1 border-l border-base-200 pl-3">
                <Arguments
                  entries={
                    Array.isArray(value)
                      ? value.map((item, n) => [String(n + 1), item])
                      : Object.entries(value)
                  }
                />
              </div>
            ) : (
              scalar(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A write through a Connection, asked at the composer (artboard 5A): the Integration, nunio's label and every argument
 * of the exact Action (ADR-0010), the headline argument first, one of a batch.
 */
export function IntegrationApprovalCard({
  proposal,
  position,
  busy,
  focus,
  onBack,
  onDecide,
}: {
  proposal: IntegrationProposal;
  position: { index: number; total: number };
  busy: boolean;
  focus?: boolean;
  onBack?: () => void;
  onDecide: (decision: Decision) => void;
}) {
  const { integration, tool } = proposal;
  const entries = Object.entries(proposal.action?.arguments ?? {});
  const headline = tool.headlineArgument;
  return (
    <ComposerCard
      icon={
        <Image
          src={integration.logo}
          width={16}
          height={16}
          alt={integration.name}
          className="size-4 shrink-0 rounded"
        />
      }
      label="Freigabe nötig"
      position={position}
      focus={focus}
      onBack={busy ? undefined : onBack}
      title={`${tool.label}?`}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("deny")}
          >
            Ablehnen
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onDecide("approve")}>
            {busy && <LoaderCircle className="motion-safe:animate-spin" />}
            {busy ? "Wird gespeichert …" : "Annehmen"}
          </Button>
        </>
      }
    >
      <Arguments
        entries={[
          ...entries.filter(([label]) => label === headline),
          ...entries.filter(([label]) => label !== headline),
        ]}
      />
    </ComposerCard>
  );
}
