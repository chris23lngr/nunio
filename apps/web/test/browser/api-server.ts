import { createServer } from "node:http";

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
  } else if (request.url === "/health") {
    response.end("{}");
  } else {
    response.writeHead(404).end("{}");
  }
}).listen(3101, "localhost");
