"use client";

import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@nunio/ui/components/trace/trace";
import { CircleAlert, LoaderCircle, SquareArrowOutUpRight } from "lucide-react";
import Link from "next/link";
import type { ChatArtifact } from "../api/chat-queries";

const names = { practice_set: "Practice Set", flashcards: "Flashcards" };
const statuses = {
  making: "in Arbeit",
  ready: "fertig",
  failed: "fehlgeschlagen",
};

/**
 * An Artifact an answer started (ADR-0019), linking to where the student studies it. Its status is as of when the Chat
 * was loaded; it does not update while the Chat stays open.
 */
export function ArtifactCard({
  kind,
  artifactId,
  artifact,
}: {
  kind: keyof typeof names;
  artifactId: string;
  artifact: ChatArtifact;
}) {
  return (
    <Trace>
      <div>
        <TraceLine
          status={artifact?.status === "making" ? "running" : undefined}
        >
          <TraceIcon>
            {!artifact || artifact.status === "failed" ? (
              <CircleAlert />
            ) : artifact.status === "making" ? (
              <LoaderCircle className="motion-safe:animate-spin" />
            ) : (
              <SquareArrowOutUpRight />
            )}
          </TraceIcon>
          {artifact ? (
            <Link href={`/study/artifacts/${encodeURIComponent(artifactId)}`}>
              <TraceTitle>{names[kind]} öffnen</TraceTitle>
            </Link>
          ) : (
            <TraceTitle>{names[kind]}</TraceTitle>
          )}
          <TraceDescription>
            {artifact
              ? statuses[artifact.status]
              : "konnte nicht gestartet werden"}
          </TraceDescription>
        </TraceLine>
      </div>
    </Trace>
  );
}
