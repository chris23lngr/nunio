import { Brain } from "lucide-react";
import Image from "next/image";

/** A Model's maker's logo, wherever a Model is chosen. */
export function ModelLogo({
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
