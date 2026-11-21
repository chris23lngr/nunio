export interface ScalewayEmailOptions {
  projectId: string;
  secretKey: string;
  from: string;
  /** External HTTP transport; tests stub Scaleway without changing auth behavior. */
  fetch?: typeof globalThis.fetch;
}

export async function sendSignInCode(
  options: ScalewayEmailOptions,
  to: string,
  code: string,
) {
  await sendEmail(
    options,
    to,
    "Dein Anmeldecode für nunio",
    `Dein Anmeldecode für nunio lautet:\n\n${code}\n\nDer Code ist 10 Minuten gültig. Gib ihn auf der Anmeldeseite ein. Wenn du keinen Code angefordert hast, kannst du diese E-Mail ignorieren.`,
  );
}

/** Tells the student a passkey was added, so they notice one they did not add (ADR-0027). */
export async function sendPasskeyAddedEmail(
  options: ScalewayEmailOptions,
  to: string,
  name: string,
  addedAt: Date,
) {
  const zone = { timeZone: "Europe/Berlin" } as const;
  const date = addedAt.toLocaleDateString("de-DE", {
    ...zone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = addedAt.toLocaleTimeString("de-DE", {
    ...zone,
    hour: "2-digit",
    minute: "2-digit",
  });
  await sendEmail(
    options,
    to,
    "Neuer Passkey für dein nunio-Konto",
    `Am ${date} um ${time} Uhr wurde deinem nunio-Konto ein neuer Passkey hinzugefügt: ${name}.\n\nWenn du das nicht warst, melde dich mit einem Code an, lösche den Passkey in den Einstellungen unter Sicherheit und melde dich überall ab.`,
  );
}

async function sendEmail(
  options: ScalewayEmailOptions,
  to: string,
  subject: string,
  text: string,
  headers?: Record<string, string>,
) {
  const response = await (options.fetch ?? globalThis.fetch)(
    "https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails",
    {
      method: "POST",
      headers: {
        "x-auth-token": options.secretKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        project_id: options.projectId,
        from: { email: options.from, name: "nunio" },
        to: [{ email: to }],
        subject,
        text,
        ...(headers && {
          additional_headers: Object.entries(headers).map(([key, value]) => ({
            key,
            value,
          })),
        }),
      }),
    },
  );
  if (!response.ok) throw new Error("Scaleway did not accept the email");
}

/** Outreach's mailer: the same Scaleway request as authentication email, with its own key and sender. */
export function createScalewayMailer(options: ScalewayEmailOptions) {
  return {
    send: (
      to: string,
      {
        subject,
        text,
        headers,
      }: { subject: string; text: string; headers?: Record<string, string> },
    ) => sendEmail(options, to, subject, text, headers),
  };
}
