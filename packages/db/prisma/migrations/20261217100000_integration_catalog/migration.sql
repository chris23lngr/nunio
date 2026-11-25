-- The Integration catalog (#280): Integrations and the tools nunio reviewed and classified (#262), seeded and changed
-- through migrations.
CREATE TABLE "integration" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dataNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'hidden',
    "kind" TEXT NOT NULL,
    "mcpUrl" TEXT,
    "transport" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "issuers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "registration" TEXT,
    "clientIdSecret" TEXT,
    "clientSecretSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "integration_key_check" CHECK ("key" ~ '^[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT "integration_status_check" CHECK ("status" IN ('hidden', 'offered', 'withdrawn')),
    CONSTRAINT "integration_kind_check" CHECK ("kind" IN ('mcp', 'email')),
    -- An MCP Integration names its server and how nunio registers with it; Email has no server. A CHECK passes
    -- when it is NULL, so a NULL column must make it false.
    CONSTRAINT "integration_mcp_check" CHECK (COALESCE(
      CASE "kind"
        WHEN 'mcp' THEN "mcpUrl" IS NOT NULL AND "transport" IN ('http', 'sse')
          AND "registration" IN ('cimd', 'dcr', 'preregistered') AND cardinality("issuers") > 0
        ELSE "mcpUrl" IS NULL AND "transport" IS NULL AND "registration" IS NULL
          AND cardinality("scopes") = 0 AND cardinality("issuers") = 0
      END, false)
    ),
    -- A pre-registered client's id and secret come from platform secrets, named here; no other registration has them.
    CONSTRAINT "integration_preregistered_check" CHECK (
      CASE WHEN "registration" = 'preregistered'
        THEN "clientIdSecret" IS NOT NULL AND "clientSecretSecret" IS NOT NULL
        ELSE "clientIdSecret" IS NULL AND "clientSecretSecret" IS NULL
      END
    )
);

CREATE TABLE "integration_tool" (
    "integrationKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "definitionHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "headlineArgument" TEXT,
    "chatOnly" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "integration_tool_pkey" PRIMARY KEY ("integrationKey", "name"),
    CONSTRAINT "integration_tool_class_check" CHECK ("class" IN ('read', 'write', 'write_always_asked', 'blocked')),
    CONSTRAINT "integration_tool_definitionHash_check" CHECK ("definitionHash" ~ '^[0-9a-f]{64}$'),
    -- As above, a missing key reads as NULL, so each check falls back to false.
    CONSTRAINT "integration_tool_definition_check" CHECK (COALESCE(
      jsonb_typeof("definition") = 'object' AND jsonb_typeof("definition" -> 'description') = 'string'
        AND jsonb_typeof("definition" -> 'inputSchema') = 'object', false)
    ),
    -- The headline is one of the tool's arguments: a key of its schema's properties object.
    CONSTRAINT "integration_tool_headlineArgument_check" CHECK (
      "headlineArgument" IS NULL OR COALESCE(
        jsonb_typeof("definition" -> 'inputSchema' -> 'properties') = 'object'
          AND "definition" -> 'inputSchema' -> 'properties' ? "headlineArgument", false)
    ),
    -- A Chat-only tool always asks, so it can never be granted.
    CONSTRAINT "integration_tool_chatOnly_check" CHECK (NOT "chatOnly" OR "class" = 'write_always_asked')
);

ALTER TABLE "integration_tool" ADD CONSTRAINT "integration_tool_integrationKey_fkey" FOREIGN KEY ("integrationKey") REFERENCES "integration"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The runtime only reads the catalog; changes belong to migrations and the operator connection.
GRANT SELECT ON "integration", "integration_tool" TO nunio_runtime;

-- Email (#263, #264): nunio's own IMAP and SMTP tools, so its pins are nunio's definitions. Hidden until the
-- Integration injection eval passes; the last Integrations ticket's migration offers it. email.search pins `folder`
-- as a string: a session narrows it to an enum of the Connection's picked folders before the model sees it (#263).
INSERT INTO "integration" ("key", "name", "logo", "description", "dataNote", "status", "kind") VALUES
  ('email', 'E-Mail', '/integrations/email.svg', 'Mails deiner Uni-Adresse durchsuchen und lesen, nach deiner Freigabe senden',
   'Daten werden von deiner Hochschule verarbeitet', 'hidden', 'email');

INSERT INTO "integration_tool" ("integrationKey", "name", "class", "label", "headlineArgument", "chatOnly", "definitionHash", "definition") VALUES
  ('email', 'email.search', 'read', 'Mails durchsuchen', NULL, false,
   'c356a114476d4e34bc2691e1f03952046ce878da66238e150080d1eea33a70f2',
   '{"description":"Searches the student''s mailbox in the folders they let nunio read, newest first. Each hit has an id, sender, recipients, date, subject, unread state, a short snippet and attachment names, but no body.","inputSchema":{"type":"object","properties":{"folder":{"type":"string","description":"The folder to search. Defaults to the inbox."},"sender":{"type":"string","description":"Only mail from this address or name."},"text":{"type":"string","description":"Words in the subject or body."},"since":{"type":"string","format":"date","description":"Only mail received on or after this day."},"before":{"type":"string","format":"date","description":"Only mail received before this day."},"unread":{"type":"boolean","description":"Only unread mail."},"limit":{"type":"integer","minimum":1,"maximum":50,"description":"How many hits at most. Defaults to 20."}},"additionalProperties":false}}'),
  ('email', 'email.read', 'read', 'Mail lesen', NULL, false,
   '4535c0f0b22add768f3e930c43361286660a4f45266d143819b8103f16ab52bb',
   '{"description":"Reads one message as plain text, without marking it read. Long bodies are cut. Attachments are listed by name, type and size only.","inputSchema":{"type":"object","properties":{"messageId":{"type":"string","description":"The id of a message, as email.search returned it."}},"required":["messageId"],"additionalProperties":false}}'),
  ('email', 'email.send', 'write_always_asked', 'Mail senden', 'to', false,
   'a05e1caa70208ba6cdecc338ebec9db480b778782d10909804d4271b8befe800',
   '{"description":"Sends a plain-text email from the student''s own address. The student approves every message before it is sent.","inputSchema":{"type":"object","properties":{"to":{"type":"array","items":{"type":"string","format":"email"},"description":"Recipients.","minItems":1},"cc":{"type":"array","items":{"type":"string","format":"email"},"description":"Copy recipients."},"bcc":{"type":"array","items":{"type":"string","format":"email"},"description":"Blind copy recipients."},"subject":{"type":"string","description":"The subject line."},"body":{"type":"string","description":"The message text."}},"required":["to","subject","body"],"additionalProperties":false}}'),
  ('email', 'email.reply', 'write_always_asked', 'Auf Mail antworten', 'body', false,
   '976d3c09e92af03dc3d41146185a51c5776706c940df4774fec740213eae29eb',
   '{"description":"Replies to a message in plain text. Recipients, the Re: subject and threading come from the original: its sender, or with replyAll everyone it was sent to. The student approves every reply before it is sent.","inputSchema":{"type":"object","properties":{"messageId":{"type":"string","description":"The id of a message, as email.search returned it."},"replyAll":{"type":"boolean","description":"Reply to everyone the original was sent to."},"body":{"type":"string","description":"The reply text."}},"required":["messageId","replyAll","body"],"additionalProperties":false}}'),
  ('email', 'email.forward', 'write_always_asked', 'Mail weiterleiten', 'to', false,
   '34dc3f8277f619b01e0bae151e2e40e9da576388c518bdb7931f33b45e1f2004',
   '{"description":"Forwards a message with its attachments, with an optional note above it. The student approves every forward before it is sent.","inputSchema":{"type":"object","properties":{"messageId":{"type":"string","description":"The id of a message, as email.search returned it."},"to":{"type":"array","items":{"type":"string","format":"email"},"description":"Recipients.","minItems":1},"cc":{"type":"array","items":{"type":"string","format":"email"},"description":"Copy recipients."},"note":{"type":"string","description":"Text above the forwarded message."}},"required":["messageId","to"],"additionalProperties":false}}'),
  ('email', 'email.submit', 'write_always_asked', 'Per E-Mail abgeben', 'subject', true,
   'f27cd61f3f217de94fa639daee79b8bee613160a177bd8414b861b5c259f494c',
   '{"description":"Hands in work for an Obligation by email to its confirmed email Destination, from the student''s own address. Attach the student''s uploaded files or Artifact draft versions. The student approves every hand-in before it is sent.","inputSchema":{"type":"object","properties":{"obligationId":{"type":"string","description":"The Obligation to hand in."},"attachments":{"type":"array","minItems":1,"description":"The files to hand in.","items":{"oneOf":[{"type":"object","properties":{"ownWorkFileId":{"type":"string","description":"A file the student uploaded."}},"required":["ownWorkFileId"],"additionalProperties":false},{"type":"object","properties":{"artifactId":{"type":"string","description":"An Artifact."},"version":{"type":"integer","minimum":1,"description":"Its draft version."}},"required":["artifactId","version"],"additionalProperties":false}]}},"subject":{"type":"string","description":"The subject line."},"body":{"type":"string","description":"The cover message."}},"required":["obligationId","attachments","subject","body"],"additionalProperties":false}}');
