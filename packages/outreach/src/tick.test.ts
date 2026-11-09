import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Principal } from "@nunio/delegation";
import {
  createDelegation,
  createResponsibilities,
  principal,
} from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import type { Facts } from "@nunio/knowledge";
import { createFacts } from "@nunio/knowledge";
import type { Plan } from "@nunio/planning";
import { createPlan } from "@nunio/planning";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Outreach, OutreachSender } from "./index.js";
import {
  createOutreach,
  createOutreachSender,
  InvalidUnsubscribeError,
  NotOpenError,
} from "./index.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the API and worker do. */
let runtime: PrismaClient;
let facts: Facts;
let plan: Plan;
let outreach: Outreach;
let sender: OutreachSender;
/** A Berlin wall-clock time in November (CET, UTC+1). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+01:00`);
let now = at("2026-11-09 08:00");
const clock = { now: () => now };
/** Records every email, and fails each send while `failing` is set. */
type Message = {
  subject: string;
  text: string;
  headers?: Record<string, string>;
};
const mail = {
  sent: [] as ({ to: string } & Message)[],
  failing: false,
};
const mailer = {
  async send(to: string, message: Message) {
    if (mail.failing) throw new Error("Scaleway is down");
    mail.sent.push({ to, ...message });
  },
};
const mailTo = (p: Principal) =>
  mail.sent.filter(
    (m) => p.kind === "student" && m.to === `${p.studentId}@example.com`,
  );
/** Records every push by endpoint; endpoints in `gone` answer as a push service does for an expired subscription. */
const push = {
  sent: [] as {
    endpoint: string;
    ttlSeconds: number;
    urgency: "low" | "normal";
  }[],
  gone: new Set<string>(),
  failing: false,
};
const pusher = {
  async send(
    subscription: { endpoint: string },
    options: { ttlSeconds: number; urgency: "low" | "normal" },
  ) {
    if (push.failing) throw new Error("push service is down");
    if (push.gone.has(subscription.endpoint)) return "gone" as const;
    push.sent.push({ endpoint: subscription.endpoint, ...options });
    return "sent" as const;
  },
};
/** Opts one new device of the student's in to push, returning its endpoint. */
async function device(p: Principal) {
  const endpoint = `https://push.example.test/${randomUUID()}`;
  await outreach.subscribe(p, {
    endpoint,
    expirationTime: null,
    keys: { p256dh: "BNcR-test-key", auth: "test-auth" },
  });
  return endpoint;
}
const pushesTo = (endpoint: string) =>
  push.sent.filter((s) => s.endpoint === endpoint);

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
  facts = createFacts({
    db: runtime,
    keys: createSourceKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    }),
    clock,
  });
  plan = createPlan({ db: runtime, facts, clock });
  outreach = createOutreach({
    db: runtime,
    clock,
    vapidPublicKey: "test-vapid-key",
    unsubscribeSecret: "test-unsubscribe-secret",
  });
  sender = createOutreachSender({
    db: runtime,
    clock,
    plan,
    facts,
    delegation: createDelegation({ db: runtime, aiEnabled: () => true }),
    responsibilities: createResponsibilities({ db: runtime, clock }),
    mailer,
    pusher,
    inboxUrl: "https://app.nunio.test/inbox",
    unsubscribe: {
      secret: "test-unsubscribe-secret",
      url: "https://api.nunio.test/unsubscribe/briefing-email",
    },
  });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

async function student(): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: { id, email: `${id}@example.com`, name: "Student" },
  });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  return principal.fromSession({ studentId: id });
}

/** An Obligation due tomorrow at noon whose Estimate decides whether there is a Shortfall. */
async function dueTomorrow(p: Principal, minutes: number, date = "2026-11-10") {
  const entered = await facts.enterObligation(p, {
    course: { title: "Analysis I", code: "MA-101" },
    kind: "assignment",
    title: `Problem sheet due ${date} (${randomUUID().slice(0, 4)})`,
    due: { date, time: "12:00", timeZone: null },
    destination: null,
  });
  if (entered.status !== "ok") throw new Error(entered.status);
  const work = { kind: "obligation" as const, id: entered.id };
  await plan.estimate(p, work, minutes);
  return work;
}

const open = async (p: Principal) =>
  (await outreach.inbox(p)).interventions.filter((i) => i.state === "open");

describe("raising Interventions from their causes", () => {
  it("raises one Intervention for a Shortfall however often it looks", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const work = await dueTomorrow(p, 20 * 60);

    await sender.tick();
    await sender.tick();

    expect(await open(p)).toEqual([
      expect.objectContaining({
        kind: "shortfall",
        subject: { kind: "work", id: work.id },
      }),
    ]);
  });

  it("lapses the Intervention once its Shortfall is gone, and raises a new one when it returns", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const work = await dueTomorrow(p, 20 * 60);
    await sender.tick();
    const [first] = await open(p);

    await plan.estimate(p, work, 30);
    await sender.tick();
    expect(await open(p)).toEqual([]);

    await plan.estimate(p, work, 20 * 60);
    await sender.tick();

    const { interventions } = await outreach.inbox(p);
    expect(interventions).toEqual([
      expect.objectContaining({ state: "open", kind: "shortfall" }),
      expect.objectContaining({
        id: first!.id,
        state: "lapsed",
        closedAt: now,
      }),
    ]);
    expect(interventions[0]!.id).not.toBe(first!.id);
  });

  it.each(["acknowledged", "dismissed"] as const)(
    "raises nothing for a Shortfall that continues after it was %s, until it ends and returns",
    async (as) => {
      now = at("2026-11-09 08:00");
      const p = await student();
      const work = await dueTomorrow(p, 20 * 60);
      await sender.tick();
      const [first] = await open(p);
      await outreach.close(p, first!.id, as);

      await plan.estimate(p, work, 22 * 60);
      await sender.tick();
      expect(await open(p)).toEqual([]);

      await plan.estimate(p, work, 30);
      await sender.tick();
      await plan.estimate(p, work, 20 * 60);
      await sender.tick();

      const { interventions } = await outreach.inbox(p);
      expect(interventions.map((i) => i.state)).toEqual(["open", as]);
    },
  );

  it("raises an Intervention for an Unconfirmed Action, which lapses once the student resolves it", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const actionId = randomUUID();
    await admin.action.create({
      data: {
        id: actionId,
        studentId: p.kind === "student" ? p.studentId : "",
        key: `chat:${actionId}`,
        kind: "studyBlock.create",
        args: {},
        status: "unconfirmed",
      },
    });
    await sender.tick();
    expect(await open(p)).toEqual([
      expect.objectContaining({
        kind: "unconfirmed",
        subject: { kind: "action", id: actionId },
      }),
    ]);

    await admin.action.update({
      where: { id: actionId },
      data: { status: "done" },
    });
    await sender.tick();

    expect((await outreach.inbox(p)).interventions).toEqual([
      expect.objectContaining({ kind: "unconfirmed", state: "lapsed" }),
    ]);
  });

  it("does not let the student close a lapsed Intervention", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const work = await dueTomorrow(p, 20 * 60);
    await sender.tick();
    const [first] = await open(p);
    await plan.estimate(p, work, 30);
    await sender.tick();

    await expect(outreach.close(p, first!.id, "dismissed")).rejects.toThrow(
      NotOpenError,
    );
  });
});

describe("the daily Briefing", () => {
  it("bundles the open Interventions once a day, after the student's Briefing time", async () => {
    now = at("2026-11-09 06:50");
    const p = await student();
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    const [shortfall] = await open(p);
    expect((await outreach.inbox(p)).briefings).toEqual([]);

    now = at("2026-11-09 07:05");
    await sender.tick();
    now = at("2026-11-09 07:10");
    await sender.tick();

    expect((await outreach.inbox(p)).briefings).toEqual([
      {
        id: expect.any(String),
        madeAt: at("2026-11-09 07:05"),
        interventions: [shortfall!.id],
        approvals: [],
        responsibilities: [],
      },
    ]);
  });

  it("makes no Briefing on a day with nothing to bundle, not even once something comes up later that day", async () => {
    now = at("2026-11-09 07:05");
    const p = await student();
    await sender.tick();

    now = at("2026-11-09 09:00");
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toEqual([]);

    now = at("2026-11-10 07:05");
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toHaveLength(1);
  });

  it("keeps what it bundled when an Intervention in it lapses afterwards", async () => {
    now = at("2026-11-09 07:05");
    const p = await student();
    const work = await dueTomorrow(p, 20 * 60);
    await sender.tick();
    const [shortfall] = await open(p);

    now = at("2026-11-09 09:00");
    await plan.estimate(p, work, 30);
    await sender.tick();

    const [briefing] = (await outreach.inbox(p)).briefings;
    expect(briefing!.interventions).toEqual([shortfall!.id]);
  });

  it("follows the time zone of the student's Plan", async () => {
    now = at("2026-11-09 07:05");
    const p = await student();
    if (p.kind !== "student") throw new Error("a student");
    await admin.planPreference.create({
      data: { studentId: p.studentId, timeZone: "America/New_York" },
    });
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toEqual([]);

    // 13:05 in Berlin is 07:05 in New York.
    now = at("2026-11-09 13:05");
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toHaveLength(1);
  });

  it("bundles the Approvals nunio waits for and the Responsibilities still active", async () => {
    now = at("2026-11-09 07:05");
    const p = await student();
    if (p.kind !== "student") throw new Error("a student");
    const { studentId } = p;
    const actionId = randomUUID();
    await admin.action.create({
      data: {
        id: actionId,
        studentId,
        key: `chat:${actionId}`,
        kind: "studyBlock.move",
        args: {},
        status: "awaiting_approval",
      },
    });
    const [active, ended] = [randomUUID(), randomUUID()];
    await admin.responsibility.createMany({
      data: [
        {
          id: active,
          studentId,
          preset: "keep_course_organized",
          budgetMicroUsd: 1_000_000,
        },
        {
          id: ended,
          studentId,
          preset: "keep_course_organized",
          budgetMicroUsd: 1_000_000,
          state: "ended",
        },
      ],
    });

    await sender.tick();

    expect((await outreach.inbox(p)).briefings).toEqual([
      expect.objectContaining({
        interventions: [],
        approvals: [actionId],
        responsibilities: [active],
      }),
    ]);
  });

  it("comes at 07:00 until the student moves it, and never once turned off", async () => {
    const p = await student();
    await dueTomorrow(p, 20 * 60);
    expect(await outreach.settings(p)).toEqual({
      briefingAtMinute: 7 * 60,
      email: true,
      briefingEmail: true,
      quietHours: null,
      dailyLimit: 3,
    });

    expect(
      await outreach.updateSettings(p, { briefingAtMinute: 9 * 60 }),
    ).toEqual({
      briefingAtMinute: 9 * 60,
      email: true,
      briefingEmail: true,
      quietHours: null,
      dailyLimit: 3,
    });
    now = at("2026-11-09 08:00");
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toEqual([]);
    now = at("2026-11-09 09:05");
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toHaveLength(1);

    await outreach.updateSettings(p, { briefingAtMinute: null });
    now = at("2026-11-10 09:05");
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toHaveLength(1);
  });
});

describe("email", () => {
  it("emails the student once about a new Intervention, with nothing in it but a count and the Inbox", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    await dueTomorrow(p, 20 * 60);

    await sender.tick();
    await sender.tick();

    expect(mailTo(p)).toEqual([
      {
        to: expect.any(String),
        subject: "nunio: 1 item needs your attention",
        text: expect.stringContaining("https://app.nunio.test/inbox"),
      },
    ]);
    expect(JSON.stringify(mailTo(p))).not.toMatch(/Problem sheet|Analysis/);
  });

  it("tries a failed email again on the next look", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    await dueTomorrow(p, 20 * 60);

    mail.failing = true;
    try {
      await sender.tick();
    } finally {
      mail.failing = false;
    }
    expect(mailTo(p)).toEqual([]);
    await sender.tick();

    expect(mailTo(p)).toHaveLength(1);
  });

  it("sends nothing about an Intervention the student closed before the email got out", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    await dueTomorrow(p, 20 * 60);
    mail.failing = true;
    try {
      await sender.tick();
    } finally {
      mail.failing = false;
    }
    const [shortfall] = await open(p);

    await outreach.close(p, shortfall!.id, "acknowledged");
    await sender.tick();

    expect(mailTo(p)).toEqual([]);
  });

  it("emails nothing while email is off, and nothing it held back once it is on again", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    expect(await outreach.updateSettings(p, { email: false })).toEqual(
      expect.objectContaining({ email: false }),
    );
    await dueTomorrow(p, 20 * 60);
    await sender.tick();

    await outreach.updateSettings(p, { email: true });
    await sender.tick();

    expect(mailTo(p)).toEqual([]);
    expect(await open(p)).toHaveLength(1);
  });

  it("announces each Briefing in its own email", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    await dueTomorrow(p, 20 * 60);
    await sender.tick();

    now = at("2026-11-09 07:05");
    await sender.tick();

    expect(mailTo(p).map((m) => m.subject)).toEqual([
      "nunio: 1 item needs your attention",
      "Your nunio Briefing is ready",
    ]);
    expect(mailTo(p)[1]!.text).toContain("https://app.nunio.test/inbox");
  });
});

describe("push", () => {
  it("pushes once to each device about a new Intervention, which stays open", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    const [phone, laptop] = [await device(p), await device(p)];
    await dueTomorrow(p, 20 * 60);

    await sender.tick();
    await sender.tick();

    for (const endpoint of [phone, laptop])
      expect(pushesTo(endpoint)).toEqual([
        { endpoint, ttlSeconds: 12 * 60 * 60, urgency: "normal" },
      ]);
    expect(await open(p)).toHaveLength(1);
  });

  it("pushes a Briefing at low urgency", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    const phone = await device(p);
    await dueTomorrow(p, 20 * 60);
    await sender.tick();

    now = at("2026-11-09 07:05");
    await sender.tick();

    expect(pushesTo(phone).map((s) => s.urgency)).toEqual(["normal", "low"]);
  });

  it("stops pushing to a device its push service says is gone, and to one the student turned off", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    const [expired, turnedOff] = [await device(p), await device(p)];
    push.gone.add(expired);
    await outreach.unsubscribe(p, turnedOff);
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    push.gone.delete(expired);

    now = at("2026-11-09 07:05");
    await sender.tick();

    expect([...pushesTo(expired), ...pushesTo(turnedOff)]).toEqual([]);
  });

  it("still pushes when email fails, and emails again on the next look", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    const phone = await device(p);
    await dueTomorrow(p, 20 * 60);

    mail.failing = true;
    try {
      await sender.tick();
    } finally {
      mail.failing = false;
    }
    expect(pushesTo(phone)).toHaveLength(1);
    await sender.tick();

    expect(mailTo(p)).toHaveLength(1);
    expect(pushesTo(phone)).toHaveLength(1);
  });
});

describe("Quiet Hours", () => {
  it("holds a message until Quiet Hours end, then sends it", async () => {
    now = at("2026-11-09 23:00");
    const p = await student();
    await outreach.updateSettings(p, {
      briefingAtMinute: null,
      quietHours: { fromMinute: 22 * 60, toMinute: 6 * 60 + 30 },
    });
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    now = at("2026-11-10 06:25");
    await sender.tick();
    expect(mailTo(p)).toEqual([]);

    now = at("2026-11-10 06:30");
    await sender.tick();

    expect(mailTo(p).map((m) => m.subject)).toEqual([
      "nunio: 1 item needs your attention",
    ]);
  });

  it("sends nothing held about an Intervention the student closed during Quiet Hours", async () => {
    now = at("2026-11-09 23:00");
    const p = await student();
    await outreach.updateSettings(p, {
      briefingAtMinute: null,
      quietHours: { fromMinute: 22 * 60, toMinute: 6 * 60 + 30 },
    });
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    const [shortfall] = await open(p);
    await outreach.close(p, shortfall!.id, "dismissed");

    now = at("2026-11-10 06:30");
    await sender.tick();

    expect(mailTo(p)).toEqual([]);
  });

  it("makes the Briefing on time but holds its email and push until Quiet Hours end", async () => {
    now = at("2026-11-10 07:05");
    const p = await student();
    const phone = await device(p);
    await outreach.updateSettings(p, {
      quietHours: { fromMinute: 22 * 60, toMinute: 8 * 60 },
    });
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toHaveLength(1);
    expect([...mailTo(p), ...pushesTo(phone)]).toEqual([]);

    now = at("2026-11-10 08:00");
    await sender.tick();

    expect(mailTo(p).map((m) => m.subject)).toEqual([
      "nunio: 1 item needs your attention",
      "Your nunio Briefing is ready",
    ]);
    expect(pushesTo(phone)).toHaveLength(2);
  });

  it("follows the time zone of the student's Plan", async () => {
    // 05:00 in Berlin is 23:00 the evening before in New York.
    now = at("2026-11-10 05:00");
    const p = await student();
    if (p.kind !== "student") throw new Error("a student");
    await admin.planPreference.create({
      data: { studentId: p.studentId, timeZone: "America/New_York" },
    });
    await outreach.updateSettings(p, {
      briefingAtMinute: null,
      quietHours: { fromMinute: 22 * 60, toMinute: 5 * 60 },
    });
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    expect(mailTo(p)).toEqual([]);

    // 11:00 in Berlin is 05:00 in New York, an hour before the Obligation is due.
    now = at("2026-11-10 11:00");
    await sender.tick();

    expect(mailTo(p)).toHaveLength(1);
  });
});

describe("the daily limit", () => {
  it("drops announcements past the day's limit, keeps Briefings, and starts again the next day", async () => {
    now = at("2026-11-09 05:00");
    const p = await student();
    const phone = await device(p);
    expect(await outreach.updateSettings(p, { dailyLimit: 1 })).toEqual(
      expect.objectContaining({ dailyLimit: 1 }),
    );
    await dueTomorrow(p, 20 * 60);
    await sender.tick();

    now = at("2026-11-09 06:00");
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    expect(mailTo(p)).toHaveLength(1);
    expect(pushesTo(phone)).toHaveLength(1);
    expect(await open(p)).toHaveLength(2);

    now = at("2026-11-09 07:05");
    await sender.tick();
    expect(mailTo(p).map((m) => m.subject)).toEqual([
      "nunio: 1 item needs your attention",
      "Your nunio Briefing is ready",
    ]);

    now = at("2026-11-10 05:00");
    await dueTomorrow(p, 20 * 60, "2026-11-11");
    await sender.tick();
    expect(mailTo(p)).toHaveLength(3);
  });
});

describe("one-click unsubscribe", () => {
  it("lets a Briefing email be unsubscribed with one click, and no Intervention email", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    if (p.kind !== "student") throw new Error("a student");
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    now = at("2026-11-09 07:05");
    await sender.tick();

    const [announcement, briefing] = mailTo(p);
    expect(announcement!.headers).toBeUndefined();
    expect(briefing!.headers).toEqual({
      "List-Unsubscribe": expect.stringMatching(
        new RegExp(
          `^<https://api\\.nunio\\.test/unsubscribe/briefing-email\\?s=${p.studentId}&t=[0-9a-f]{64}>$`,
        ),
      ),
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("stops Briefing emails only: Briefings stay in the Inbox and Interventions are still emailed", async () => {
    now = at("2026-11-09 06:00");
    const p = await student();
    await dueTomorrow(p, 20 * 60);
    await sender.tick();
    now = at("2026-11-09 07:05");
    await sender.tick();
    const link = new URL(
      mailTo(p)[1]!.headers!["List-Unsubscribe"]!.slice(1, -1),
    );

    await outreach.stopBriefingEmail(
      link.searchParams.get("s")!,
      link.searchParams.get("t")!,
    );

    expect(await outreach.settings(p)).toEqual(
      expect.objectContaining({ briefingEmail: false, email: true }),
    );
    now = at("2026-11-10 05:00");
    await dueTomorrow(p, 20 * 60, "2026-11-11");
    await sender.tick();
    now = at("2026-11-10 07:05");
    await sender.tick();
    expect((await outreach.inbox(p)).briefings).toHaveLength(2);
    expect(mailTo(p).map((m) => m.subject)).toEqual([
      "nunio: 1 item needs your attention",
      "Your nunio Briefing is ready",
      "nunio: 1 item needs your attention",
    ]);
  });

  it("refuses a tampered link, or one signed for another student, and changes nothing", async () => {
    now = at("2026-11-09 07:05");
    const p = await student();
    const other = await student();
    if (p.kind !== "student" || other.kind !== "student")
      throw new Error("students");
    await dueTomorrow(other, 20 * 60);
    await sender.tick();
    const theirs = new URL(
      mailTo(other)
        .find((m) => m.headers)!
        .headers!["List-Unsubscribe"]!.slice(1, -1),
    ).searchParams.get("t")!;

    for (const token of [theirs, "0".repeat(64), "short"])
      await expect(
        outreach.stopBriefingEmail(p.studentId, token),
      ).rejects.toThrow(InvalidUnsubscribeError);

    expect(await outreach.settings(p)).toEqual(
      expect.objectContaining({ briefingEmail: true }),
    );
  });
});
