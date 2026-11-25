/**
 * "Testnotizen", the note service the fake MCP server serves. Its tool definitions are what the catalog seed pins.
 */
import type { CallToolResult, Tool } from "@modelcontextprotocol/server";

export const testnotizenTools: Tool[] = [
  {
    name: "notes.search",
    description: "Searches the workspace's notes by title and text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to search for." },
      },
      required: ["query"],
    },
  },
  {
    name: "notes.read",
    description: "Reads one note by its id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The note's id." } },
      required: ["id"],
    },
  },
  {
    name: "notes.create_page",
    description: "Creates a new page in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The page's title." },
        content: { type: "string", description: "The page's text." },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "notes.share",
    description: "Shares a note with another person by email.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The note's id." },
        email: { type: "string", description: "Who to share it with." },
      },
      required: ["id", "email"],
    },
  },
];

interface Note {
  id: string;
  title: string;
  content: string;
}

/** One workspace of notes in memory, with a handler per tool. A tool added by drift answers "ok". */
export function createTestnotizen(): (
  tool: string,
  args: Record<string, unknown>,
) => CallToolResult {
  const notes = new Map<string, Note>(
    [
      {
        id: "note-1",
        title: "Lineare Algebra – Woche 3",
        content: "Eigenwerte und Eigenvektoren. Übungsblatt 3 bis Freitag.",
      },
      {
        id: "note-2",
        title: "Projekt Datenbanken",
        content: "Treffen mit Prof. Lenz am Dienstag, ER-Modell mitbringen.",
      },
    ].map((note) => [note.id, note]),
  );
  const text = (value: string): CallToolResult => ({
    content: [{ type: "text", text: value }],
  });
  const notFound = (id: string): CallToolResult => ({
    ...text(`Notiz ${id} nicht gefunden.`),
    isError: true,
  });

  return (tool, args) => {
    const arg = (name: string) => String(args[name] ?? "");
    switch (tool) {
      case "notes.search": {
        const query = arg("query").toLowerCase();
        const found = [...notes.values()].filter((note) =>
          `${note.title} ${note.content}`.toLowerCase().includes(query),
        );
        return text(
          found.map((note) => `${note.id}: ${note.title}`).join("\n") ||
            "Keine Notizen gefunden.",
        );
      }
      case "notes.read": {
        const note = notes.get(arg("id"));
        return note
          ? text(`${note.title}\n\n${note.content}`)
          : notFound(arg("id"));
      }
      case "notes.create_page": {
        const id = `note-${notes.size + 1}`;
        notes.set(id, { id, title: arg("title"), content: arg("content") });
        return text(`Seite ${id} angelegt.`);
      }
      case "notes.share":
        return notes.has(arg("id"))
          ? text(`Notiz ${arg("id")} mit ${arg("email")} geteilt.`)
          : notFound(arg("id"));
      default:
        return text("ok");
    }
  };
}
