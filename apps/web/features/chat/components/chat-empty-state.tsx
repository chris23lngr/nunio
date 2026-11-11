import {
  Suggestion,
  Suggestions,
} from "@nunio/ui/components/suggestion/suggestion";

type ChatEmptyStateProps = {
  firstName: string;
  prompts: string[];
  onPrompt: (prompt: string) => void;
};

export function ChatEmptyState({
  firstName,
  prompts,
  onPrompt,
}: ChatEmptyStateProps) {
  return (
    <div className="flex min-h-full flex-col items-center pt-[min(20vh,200px)] pb-8">
      <h1 className="max-w-[416px] text-center text-2xl leading-8 font-medium text-base-800 sm:text-3xl sm:leading-9">
        Woran möchtest du heute arbeiten, {firstName}?
      </h1>
      <Suggestions className="mt-8 max-w-[640px]">
        {prompts.map((prompt) => (
          <Suggestion key={prompt} suggestion={prompt} onClick={onPrompt} />
        ))}
      </Suggestions>
    </div>
  );
}
