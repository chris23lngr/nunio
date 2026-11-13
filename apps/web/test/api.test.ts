import { expect, test } from "vitest";
import { api } from "./api";

let late: Promise<Response>;

test("a request still arriving when its test ends is served by that test", () => {
  api.route("POST", "/late", () => new Response("served"));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode("late"));
        controller.close();
      }, 50);
    },
  });
  late = fetch(`${api.origin}/late`, {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
});

test("so the next test does not inherit it", async () => {
  expect(await (await late).text()).toBe("served");
});

test("requests to another host, like a local port probe, are not the app's", async () => {
  const probe = await fetch(api.origin.replace("127.0.0.1", "localhost"));
  expect(probe.status).toBe(404);
});
