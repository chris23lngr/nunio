import { serve } from "@hono/node-server";
import { appFromEnv } from "./create-app.js";

const port = Number(process.env.PORT ?? 3001);
// Scaleway rejects the local keys, so authentication email, sign-in codes included, goes to the log (CONTRIBUTING.md).
const emailFetch: typeof fetch = async (_input, init) => {
  const { to, subject, text } = JSON.parse(String(init?.body)) as {
    to: { email: string }[];
    subject: string;
    text: string;
  };
  console.log(
    JSON.stringify({ msg: "email not sent", to: to[0]?.email, subject, text }),
  );
  return Response.json({ emails: [] }, { status: 201 });
};
serve({ fetch: (await appFromEnv(process.env, { emailFetch })).fetch, port });
console.log(JSON.stringify({ msg: "api listening", port }));
