import type { ServerResponse } from "node:http";
import { createServer } from "node:http";

const chatId = "00000000-0000-4000-8000-000000000001";
const history = Array.from({ length: 12 }, (_, index) => {
  const text =
    index % 2
      ? "Eine ausführliche Antwort mit mehreren Absätzen.\n\n".repeat(4)
      : `Frage ${index / 2 + 1}`;
  return {
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    role: index % 2 ? "assistant" : "student",
    text,
    parts: [{ type: "text", text }],
    citations: [],
    createdAt: "2026-11-10T09:48:00Z",
  };
});
// The student's Chats, most recent first: the one with `history`, then enough to need a second page of 30.
const chats = Array.from({ length: 35 }, (_, index) => ({
  id: index
    ? `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`
    : chatId,
  title: index ? `Älterer Chat ${index}` : "Frage 1",
  // Four and a half days ago, then a day earlier each.
  lastActivityAt: new Date(
    Date.now() - (index + 4.5) * 86_400_000,
  ).toISOString(),
}));
// A practice set as in Paper's study screens, its first three questions answered and graded.
const practiceSetId = "00000000-0000-4000-8000-000000000700";
const source = {
  kind: "source",
  sourceId: "00000000-0000-4000-8000-000000000701",
  title: "02 Nachfrageprognose OM26.pdf",
  location: { page: 7 },
};
const questions = [
  "Nenne die sieben Eigenschaften, die eine gut vorbereitete Prognose erfüllen sollte.",
  "Was bedeutet das Kriterium der Rechtzeitigkeit, und warum ist es für die Planung wichtig?",
  "Was verlangt das Kriterium der Genauigkeit, und warum reicht es nicht aus, nur eine möglichst genaue Prognose zu haben?",
  "Erkläre den Unterschied zwischen Verlässlichkeit und Verständlichkeit einer Prognose.",
  "Warum soll eine Prognose dokumentiert werden, und was versteht man unter zweckmäßigen Einheiten?",
  "Was fordert das Kriterium der Wirtschaftlichkeit?",
];
const practiceSet = {
  id: practiceSetId,
  kind: "practice_set",
  status: "ready",
  failure: null,
  topicIds: [],
  obligationId: null,
  createdAt: "2026-11-10T09:00:00Z",
  openedAt: "2026-11-10T09:01:00Z",
  withdrawn: false,
  version: 1,
  content: {
    title:
      "Rechtzeitigkeit, Genauigkeit, Verlässlichkeit, Dokumentation und weitere Gütekriterien",
    items: questions.map((question, index) => ({
      id: String(index + 1),
      topicIds: [],
      question: `${question} [S1]`,
      answer: "Siehe Skript [S1].",
      citations: [{ tag: "S1", provenance: source }],
    })),
  },
};
const graded = [
  [
    "Rechtzeitigkeit, Genauigkeit, Verlässlichkeit, zweckmäßige Einheiten, Dokumentation, Verständlichkeit, Wirtschaftlichkeit",
    "correct",
    "Alle sieben Eigenschaften sind vollständig und richtig genannt [S1].",
  ],
  [
    "Die Prognose muss rechtzeitig vorliegen, damit man sie für die Planung nutzen kann.",
    "partial",
    "Du hast richtig erkannt, dass eine Prognose rechtzeitig vorliegen muss [S1]. Es fehlt aber, warum das wichtig ist [S1].",
  ],
  [
    "Die Prognose soll möglichst exakt eintreffen.",
    "incorrect",
    "Genauigkeit heißt nicht, dass die Prognose exakt eintrifft [S1].",
  ],
].map(([text, verdict, feedback], index) => ({
  id: `00000000-0000-4000-8000-00000000071${index}`,
  artifactId: practiceSetId,
  itemId: String(index + 1),
  topicIds: [],
  text,
  verdict,
  feedback: { text: feedback, citations: [{ tag: "S1", provenance: source }] },
  ungradedReason: null,
  createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
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
        parts: [{ type: "text", text }],
        citations: [],
        createdAt: "2026-11-10T09:49:00Z",
        question: {
          id: questionId,
          role: "student",
          text: "Noch eine Frage",
          parts: [{ type: "text", text: "Noch eine Frage" }],
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
  } else if (request.url?.startsWith("/api/me/chats?")) {
    // The cursor is the index to continue from.
    const query = new URL(request.url, "http://localhost").searchParams;
    const from = Number(query.get("cursor") ?? 0);
    const to = from + Number(query.get("limit"));
    response.end(
      JSON.stringify({
        chats: chats.slice(from, to),
        nextCursor: to < chats.length ? String(to) : null,
      }),
    );
  } else if (request.url === `/api/me/chats/${chatId}`) {
    response.end(
      JSON.stringify({ id: chatId, courses: [], messages: history }),
    );
  } else if (request.url === `/api/me/artifacts/${practiceSetId}`) {
    response.end(JSON.stringify(practiceSet));
  } else if (request.url === `/api/me/artifacts/${practiceSetId}/attempts`) {
    response.end(JSON.stringify(graded));
  } else if (request.url === "/health") {
    response.end("{}");
  } else {
    response.writeHead(404).end("{}");
  }
}).listen(3101, "localhost");
