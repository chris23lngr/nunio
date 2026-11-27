/**
 * Reading mail (#263, #265): `email.search` and `email.read` over IMAP, as a read session like an MCP Connection's.
 * The mailbox looks the same afterwards: every folder is opened read-only (EXAMINE) and every body fetched with
 * `BODY.PEEK`, so nothing is marked read, moved or deleted. Everything a mail carries, headers and folder names
 * included, reaches the model fenced as `Untrusted` data; only nunio's own refusals are not.
 */
import { convert } from "html-to-text";
import type {
  FetchMessageObject,
  ImapFlow,
  MessageAddressObject,
  MessageStructureObject,
  SearchObject,
} from "imapflow";
import type { ReadResult, ReadSession } from "../reads.js";
import { READ_RESULT_MAX_CHARACTERS, shapeText } from "../shape.js";
import { imapClient, mailEndpoint } from "./mailbox.js";
import type { MailServer } from "./providers.js";
import type { Lookup } from "./servers.js";

/** A mailbox as nunio reads it: the stored login and IMAP server, and the folders the student picked. */
export interface ReadableMailbox {
  username: string;
  password: string;
  imap: MailServer;
  /** The IMAP paths nunio may read. */
  folders: string[];
}

const DEFAULT_HITS = 20;
const MAX_HITS = 50;
const SNIPPET_CHARACTERS = 200;
/** How much of a hit's text part nunio fetches for its snippet. */
const SNIPPET_BYTES = 4_096;
/** How much of a message's text part nunio fetches; HTML takes many bytes per character of text. */
const BODY_BYTES = 1_000_000;

/** A failure that is nunio's own answer to the model, never retried. */
class Refused extends Error {}

const messageNotFound = () =>
  new Refused(
    "message_not_found: no message with this id in the folders the student lets nunio read. Use an id email.search returned.",
  );

/** A message id: folder, UIDVALIDITY and UID, opaque to the model. */
function encodeId(folder: string, uidValidity: bigint, uid: number) {
  return Buffer.from(
    JSON.stringify([folder, uidValidity.toString(), uid]),
  ).toString("base64url");
}

function decodeId(id: unknown) {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(String(id), "base64url").toString("utf8"),
    );
    if (!Array.isArray(decoded)) return null;
    const [folder, uidValidity, uid] = decoded as unknown[];
    if (
      typeof folder !== "string" ||
      typeof uidValidity !== "string" ||
      !/^\d+$/.test(uidValidity) ||
      !Number.isSafeInteger(uid) ||
      (uid as number) < 1
    )
      return null;
    return { folder, uidValidity, uid: uid as number };
  } catch {
    return null;
  }
}

/** An address as a person writes it. */
const addresses = (list: MessageAddressObject[] | undefined) =>
  (list ?? []).map(({ name, address }) =>
    name ? `${name} <${address ?? ""}>` : (address ?? ""),
  );

const isAttachment = (node: MessageStructureObject) =>
  node.disposition?.toLowerCase() === "attachment" ||
  Boolean(node.dispositionParameters?.filename);

/** Every leaf part of a message, depth first. */
function leaves(node: MessageStructureObject): MessageStructureObject[] {
  return node.childNodes?.length ? node.childNodes.flatMap(leaves) : [node];
}

/** The part a message's text comes from: its text/plain part, else its HTML; null if it has neither. */
function textPart(structure: MessageStructureObject | undefined) {
  if (!structure) return null;
  const inline = leaves(structure).filter((node) => !isAttachment(node));
  const node =
    inline.find((n) => n.type === "text/plain") ??
    inline.find((n) => n.type === "text/html");
  if (!node) return null;
  return {
    // A message that is a single part has its body as its TEXT.
    section: node.part ?? "TEXT",
    html: node.type === "text/html",
    encoding: node.encoding?.toLowerCase(),
    charset: node.parameters?.charset,
  };
}

/** A text part's raw bytes as text, by the encoding and charset its structure names; an unknown charset reads as UTF-8. */
function decodePart(
  raw: Buffer,
  { encoding, charset }: { encoding?: string; charset?: string },
) {
  const bytes =
    encoding === "base64"
      ? Buffer.from(raw.toString("latin1"), "base64")
      : encoding === "quoted-printable"
        ? Buffer.from(
            raw
              .toString("latin1")
              .replace(/=\r?\n/g, "")
              .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
                String.fromCharCode(Number.parseInt(hex, 16)),
              ),
            "latin1",
          )
        : raw;
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** A message's attachments: name, type and the size of their decoded content. */
function attachmentsOf(structure: MessageStructureObject | undefined) {
  if (!structure) return [];
  return leaves(structure)
    .filter(isAttachment)
    .map((node) => {
      const size = node.size ?? 0;
      return {
        name:
          node.dispositionParameters?.filename ??
          node.parameters?.name ??
          "unbenannt",
        type: node.type,
        // About: base64 carries 3 bytes in 4 characters, in lines of 76 and a line break.
        size:
          node.encoding?.toLowerCase() === "base64"
            ? Math.floor(((size - 2 * Math.ceil(size / 78)) * 3) / 4)
            : size,
      };
    });
}

/** HTML as text, with link URLs inline as plain text and quoted history kept. */
const htmlToText = (html: string) =>
  convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
    ],
  });

/** Parses a `YYYY-MM-DD` argument; undefined if absent. */
function dateArgument(value: unknown, name: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Refused(`Refused: ${name} must be a date as YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()))
    throw new Refused(`Refused: ${name} must be a date as YYYY-MM-DD.`);
  return date;
}

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * `email.search`'s pinned definition for a Connection: its `folder` narrowed to an enum of the picked folders, so the
 * model can name no other (#263).
 */
export function emailSearchDefinition(
  definition: { description: string; inputSchema: Record<string, unknown> },
  folders: string[],
) {
  const properties = (definition.inputSchema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return {
    ...definition,
    inputSchema: {
      ...definition.inputSchema,
      properties: {
        ...properties,
        folder: { ...properties.folder, enum: folders },
      },
    },
  };
}

/** Whether an IMAP failure is the server refusing the login, which no retry fixes. */
const loginRefused = (error: unknown) =>
  (error as { authenticationFailed?: boolean } | null)?.authenticationFailed ===
  true;

/**
 * A read session on a mailbox. The client opens at the first read, connecting to the address nunio checked is
 * public, and stays open for the session. A read gets 30 s and one retry after the connection fails; a refused login
 * is final.
 */
export function openEmailReads(
  /** The mailbox, read at the first read; null when the Connection can't be read. */
  mailbox: () => Promise<ReadableMailbox | null>,
  {
    fakes,
    lookup,
    timeoutMs,
  }: {
    fakes: boolean;
    lookup?: Lookup;
    /** How long one read may take, opening the client included (`READ_TIMEOUT_MS`). */
    timeoutMs: number;
  },
): ReadSession {
  let opened: Promise<{ client: ImapFlow; folders: string[] }> | undefined;

  function open() {
    opened ??= (async () => {
      const readable = await mailbox();
      if (!readable)
        throw new Refused("This Connection can't be read right now.");
      const { username, password, imap, folders } = readable;
      const endpoint = await mailEndpoint("imap", imap, { fakes, lookup });
      if ("ok" in endpoint)
        throw new Refused("This Connection can't be read right now.");
      const client = imapClient(username, password, endpoint);
      await client.connect();
      return { client, folders };
    })().catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  }

  /** Drops a client whose connection failed, so the retry or the next read opens another. */
  function discard(dead: typeof opened) {
    if (opened === dead) opened = undefined;
    void dead?.then(({ client }) => client.close()).catch(() => {});
  }

  /**
   * Opens a folder read-only (EXAMINE) and holds it; a folder the server refuses, as one deleted since the student
   * picked it, is `missing`.
   */
  async function examine(client: ImapFlow, folder: string, missing: Refused) {
    try {
      return await client.getMailboxLock(folder, { readOnly: true });
    } catch (error) {
      if ((error as { responseStatus?: string }).responseStatus === "NO")
        throw missing;
      throw error;
    }
  }

  /**
   * The text of a message's text part, from at most `maxBytes` of it, fetched with `BODY.PEEK` and decoded by its
   * structure rather than its MIME headers, which not every server serves for a nested part.
   */
  async function textOf(
    client: ImapFlow,
    uid: number,
    structure: MessageStructureObject | undefined,
    maxBytes: number,
  ) {
    const part = textPart(structure);
    if (!part) return "";
    const fetched = await client.fetchOne(
      String(uid),
      {
        uid: true,
        bodyParts: [{ key: part.section, start: 0, maxLength: maxBytes }],
      },
      { uid: true },
    );
    // The one section asked for, under whatever case the server answers its name in.
    const [raw] = fetched ? (fetched.bodyParts?.values() ?? []) : [];
    if (!raw) return "";
    const text = decodePart(raw, part);
    return part.html ? htmlToText(text) : text;
  }

  async function search(
    client: ImapFlow,
    folders: string[],
    args: Record<string, unknown>,
  ): Promise<string> {
    const folder =
      args.folder === undefined
        ? folders.includes("INBOX")
          ? "INBOX"
          : folders[0]
        : folders.find((picked) => picked === args.folder);
    if (folder === undefined)
      throw new Refused(
        "Refused: search only one of the folders the student lets nunio read, as the folder parameter lists them.",
      );
    const limit = Math.min(
      MAX_HITS,
      Math.max(
        1,
        Number.isInteger(args.limit) ? (args.limit as number) : DEFAULT_HITS,
      ),
    );
    const query: SearchObject = {
      from: optionalString(args.sender),
      text: optionalString(args.text),
      since: dateArgument(args.since, "since"),
      before: dateArgument(args.before, "before"),
      seen: args.unread === true ? false : undefined,
    };
    const lock = await examine(
      client,
      folder,
      new Refused("This folder can't be read right now."),
    );
    try {
      const uidValidity = client.mailbox ? client.mailbox.uidValidity : 0n;
      const filters = Object.fromEntries(
        Object.entries(query).filter(([, value]) => value !== undefined),
      );
      const found =
        (await client.search(
          Object.keys(filters).length ? filters : { all: true },
          { uid: true },
        )) || [];
      // The highest UIDs arrived last; only those are fetched, then ordered by their date.
      const newest = found.sort((a, b) => b - a).slice(0, limit);
      const fetched: FetchMessageObject[] = newest.length
        ? await client.fetchAll(
            newest.join(","),
            {
              uid: true,
              flags: true,
              envelope: true,
              bodyStructure: true,
              internalDate: true,
            },
            { uid: true },
          )
        : [];
      const time = (m: FetchMessageObject) =>
        new Date(m.internalDate ?? 0).getTime();
      fetched.sort((a, b) => time(b) - time(a) || b.uid - a.uid);
      const hits = [];
      for (const m of fetched) {
        const text = await textOf(
          client,
          m.uid,
          m.bodyStructure,
          SNIPPET_BYTES,
        );
        hits.push({
          id: encodeId(folder, uidValidity, m.uid),
          from: addresses(m.envelope?.from),
          to: addresses(m.envelope?.to),
          cc: addresses(m.envelope?.cc),
          date: new Date(m.envelope?.date ?? m.internalDate ?? 0).toISOString(),
          subject: m.envelope?.subject ?? "",
          unread: !m.flags?.has("\\Seen"),
          snippet: text
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, SNIPPET_CHARACTERS),
          attachments: attachmentsOf(m.bodyStructure).map((a) => a.name),
        });
      }
      // The cap drops whole hits from the end, never part of one.
      let kept = hits.length;
      while (
        kept > 0 &&
        JSON.stringify(hits.slice(0, kept)).length > READ_RESULT_MAX_CHARACTERS
      )
        kept -= 1;
      return shapeText(JSON.stringify(hits.slice(0, kept)), {
        truncated: kept < hits.length,
      });
    } finally {
      lock.release();
    }
  }

  async function read(
    client: ImapFlow,
    folders: string[],
    args: Record<string, unknown>,
  ): Promise<string> {
    const id = decodeId(args.messageId);
    if (!id || !folders.includes(id.folder)) throw messageNotFound();
    const lock = await examine(client, id.folder, messageNotFound());
    try {
      if (
        !client.mailbox ||
        client.mailbox.uidValidity.toString() !== id.uidValidity
      )
        throw messageNotFound();
      const m = await client.fetchOne(
        String(id.uid),
        { uid: true, flags: true, envelope: true, bodyStructure: true },
        { uid: true },
      );
      if (!m) throw messageNotFound();
      const head = {
        id: args.messageId,
        folder: id.folder,
        from: addresses(m.envelope?.from),
        to: addresses(m.envelope?.to),
        cc: addresses(m.envelope?.cc),
        date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
        subject: m.envelope?.subject ?? "",
        unread: !m.flags?.has("\\Seen"),
        attachments: attachmentsOf(m.bodyStructure),
      };
      const body = await textOf(client, m.uid, m.bodyStructure, BODY_BYTES);
      return shapeText(`${JSON.stringify(head)}\n\n${body}`);
    } finally {
      lock.release();
    }
  }

  return {
    async read(toolName, args, { signal }): Promise<ReadResult> {
      for (let attempt = 1; ; attempt++) {
        const deadline = AbortSignal.any([
          signal,
          AbortSignal.timeout(timeoutMs),
        ]);
        let used: typeof opened;
        try {
          const call = (async () => {
            used = open();
            const { client, folders } = await used;
            if (toolName === "email.search")
              return search(client, folders, args);
            if (toolName === "email.read") return read(client, folders, args);
            throw new Refused(`Refused: ${toolName} is not a read tool.`);
          })();
          const aborted = new Promise<never>((_, reject) => {
            const stop = () => reject(deadline.reason);
            if (deadline.aborted) stop();
            deadline.addEventListener("abort", stop, { once: true });
          });
          // The losing call settles on its own once its client is closed.
          call.catch(() => {});
          return {
            outcome: "answered",
            text: await Promise.race([call, aborted]),
          };
        } catch (error) {
          if (error instanceof Refused)
            return { outcome: "failed", text: error.message };
          // IMAP can't abort one command: the client goes, and the next read opens another.
          discard(used);
          signal.throwIfAborted();
          if (loginRefused(error))
            return {
              outcome: "failed",
              text: "The mailbox refused nunio's login.",
            };
          if (attempt > 1)
            return {
              outcome: "failed",
              text: deadline.aborted
                ? "The mailbox did not answer in time."
                : "The mailbox could not be reached.",
            };
        }
      }
    },
    async close() {
      const open = opened;
      opened = undefined;
      await open?.then(({ client }) => client.logout()).catch(() => {});
    },
  };
}
