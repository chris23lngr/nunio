"use client";

import { createApiClient, type paths } from "@nunio/api-client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type Message = paths["/api/me/chats/{id}/messages"]["get"]["responses"][200]["content"]["application/json"][number];
type Course = paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
type Source = paths["/api/me/sources"]["get"]["responses"][200]["content"]["application/json"][number];
const refusals: Record<string, string> = {
  allowance_exhausted: "Your AI allowance is used up. Contact support to continue.",
  ai_disabled: "Answers are paused right now. Please try again later.",
};

function Citations({ citations }: { citations: Message["citations"] }) {
  if (!citations.length) return null;
  return <ul>{citations.map(({ tag, provenance }) => <li key={tag}>
    [{tag}] {provenance === "gone" ? "This Source was deleted."
      : provenance.kind === "source" ? `${provenance.title}, page ${provenance.location.page}` : "Your own entry"}
  </li>)}</ul>;
}

/** Starts a Chat over the Courses and Sources the student selects, then answers from them only. */
export function ChatView({ apiOrigin, chatId }: { apiOrigin: string; chatId: string | null }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const client = () => createApiClient(apiOrigin);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (chatId) {
          const result = await createApiClient(apiOrigin).GET("/api/me/chats/{id}/messages", { params: { path: { id: chatId } } });
          if (cancelled) return;
          if (!result.data) return setError("This Chat is gone.");
          setMessages(result.data);
        } else {
          const [review, listed] = await Promise.all([createApiClient(apiOrigin).GET("/api/me/review"), createApiClient(apiOrigin).GET("/api/me/sources")]);
          if (cancelled) return;
          if (!review.data || !listed.data) return setError("Could not load your Courses and Sources.");
          setCourses(review.data.courses.filter(course => course.status === "accepted"));
          setSources(listed.data.filter(source => source.status === "ready"));
        }
      } catch { if (!cancelled) setError("Could not load the Chat."); }
    })();
    return () => { cancelled = true; };
  }, [apiOrigin, chatId]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const result = await client().POST("/api/me/chats", { body: {
        courseIds: form.getAll("course").map(String), sourceIds: form.getAll("source").map(String) } });
      if (!result.data) throw new Error("A selected Course or Source is gone. Reload and choose again.");
      router.push(`/chat?id=${result.data.id}`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start the Chat."); }
    finally { setBusy(false); }
  }
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chatId) return;
    const form = event.currentTarget;
    const text = String(new FormData(form).get("text") ?? "").trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      const result = await client().POST("/api/me/chats/{id}/messages", { params: { path: { id: chatId } }, body: { text } });
      if (!result.data) {
        const reason = (result.error as { error?: string } | undefined)?.error ?? "";
        throw new Error(refusals[reason] ?? (result.response.status === 404 ? "This Chat is gone." : "Could not answer. Please try again."));
      }
      const answer = result.data;
      setMessages(current => [...current, { id: `${answer.id}-question`, role: "student", text, citations: [] }, answer]);
      form.reset();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not answer. Please try again."); }
    finally { setBusy(false); }
  }

  if (!chatId) return (
    <section aria-labelledby="chat-title">
      <h1 id="chat-title">New Chat</h1>
      <p>Choose what nunio may read. It answers only from your selection; with nothing selected, it reads nothing.</p>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={start}>
        <fieldset><legend>Courses</legend>
          {courses.length ? courses.map(course => <label key={course.id}>
            <input type="checkbox" name="course" value={course.id} /> {course.code ? `${course.code} ` : ""}{course.title}
          </label>) : <p>No accepted Courses yet.</p>}
        </fieldset>
        <fieldset><legend>Sources</legend>
          {sources.length ? sources.map(source => <label key={source.id}>
            <input type="checkbox" name="source" value={source.id} /> {source.title}
          </label>) : <p>No ready Sources yet.</p>}
        </fieldset>
        <button type="submit" disabled={busy}>{busy ? "Please wait…" : "Start Chat"}</button>
      </form>
    </section>
  );
  return (
    <section aria-labelledby="chat-title">
      <h1 id="chat-title">Chat</h1>
      <ol>{messages.map(message => <li key={message.id}>
        <strong>{message.role === "student" ? "You" : "nunio"}:</strong> {message.text}
        <Citations citations={message.citations} />
      </li>)}</ol>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={ask}>
        <label>Question <textarea name="text" required maxLength={4000} disabled={busy} /></label>
        <button type="submit" disabled={busy}>{busy ? "Answering…" : "Ask"}</button>
      </form>
    </section>
  );
}
