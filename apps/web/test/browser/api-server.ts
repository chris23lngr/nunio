import type { ServerResponse } from "node:http";
import { createServer } from "node:http";

const chatId = "00000000-0000-4000-8000-000000000001";
const history = Array.from({ length: 12 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
  role: index % 2 ? "assistant" : "student",
  text:
    index % 2
      ? "Eine ausführliche Antwort mit mehreren Absätzen.\n\n".repeat(4)
      : `Frage ${index / 2 + 1}`,
  citations: [],
  createdAt: "2026-11-10T09:48:00Z",
}));
// The open answer stream, finished by GET /release-stream.
let release: (() => void) | undefined;

function streamAnswer(response: ServerResponse, questionId: string) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (chunk: unknown) =>
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  const answerId = "00000000-0000-4000-8000-000000000999";
  const text = "Die gestreamte Antwort.\n\n".repeat(20);
  emit({ type: "start", messageId: answerId });
  emit({ type: "text-start", id: "answer" });
  emit({ type: "text-delta", id: "answer", delta: text });
  release = () => {
    emit({ type: "text-end", id: "answer" });
    emit({
      type: "data-committed",
      data: {
        id: answerId,
        role: "assistant",
        text,
        citations: [],
        createdAt: "2026-11-10T09:49:00Z",
        question: {
          id: questionId,
          role: "student",
          text: "Noch eine Frage",
          citations: [],
          createdAt: "2026-11-10T09:49:00Z",
        },
      },
    });
    emit({ type: "finish" });
    response.end("data: [DONE]\n\n");
  };
}

// A controlled auth boundary for browser checks; no database or live account.
createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:3100");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.url === `/api/me/chats/${chatId}/messages/stream`) {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => streamAnswer(response, JSON.parse(body).id));
    return;
  }
  if (request.url === "/release-stream") {
    release?.();
    release = undefined;
    response.end("{}");
    return;
  }
  if (request.url === "/preview") {
    response
      .writeHead(302, {
        "Set-Cookie":
          "better-auth.session_token=sidebar-browser-test; Path=/; SameSite=Lax",
        Location: "http://localhost:3100/settings/security",
      })
      .end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (request.url?.startsWith("/api/auth/get-session")) {
    response.end(
      JSON.stringify({
        session: {
          id: "sidebar-session",
          token: "sidebar-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        user: {
          id: "student",
          name: "Justus Schuhmacher",
          email: "justus@example.com",
          emailVerified: true,
        },
      }),
    );
  } else if (request.url === "/api/auth/list-sessions") {
    response.end("[]");
  } else if (request.url === `/api/me/chats/${chatId}`) {
    response.end(
      JSON.stringify({ id: chatId, courses: [], messages: history }),
    );
  } else if (request.url === "/health") {
    response.end("{}");
  } else {
    response.writeHead(404).end("{}");
  }
}).listen(3101, "localhost");
