import { Button } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nunio/ui/components/dialog/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import type { EmailLogin, MailFolder } from "../api/email-connection";
import {
  emailConnectMutation,
  emailDiscoveryQuery,
  emailTestMutation,
  MailboxRefused,
} from "../api/email-connection";
import { integrationQueries } from "../api/integration-queries";

const noServers = {
  imapHost: "",
  imapPort: "993",
  smtpHost: "",
  smtpPort: "587",
};

/** A folder chip's label: the inbox and Sent by their German names, others as the mailbox names them. */
function folderLabel(folder: MailFolder) {
  if (folder.specialUse === "\\Inbox") return "Posteingang";
  if (folder.specialUse === "\\Sent") return "Gesendet";
  return folder.name;
}

/** What a refused mailbox means to the student, except a failed login, which shows its step. */
function refusalMessage(error: Error) {
  if (!(error instanceof MailboxRefused)) return error.message;
  switch (error.refusal.error) {
    case "port_refused":
      return "nunio verbindet sich nur verschlüsselt: IMAP auf Port 993 oder 143, SMTP auf 465 oder 587.";
    case "server_refused":
      return "nunio erreicht diesen Server nicht. Prüfe den Namen.";
    case "unsupported":
      return "Diese Uni-Mail kann nunio noch nicht verbinden.";
    default:
      return "Die Anmeldung hat nicht geklappt. Prüfe deine Angaben.";
  }
}

/** One step of the login check, with its outcome. */
function Step({ ok, children }: { ok: boolean; children: string }) {
  const Icon = ok ? Check : X;
  return (
    <span
      data-outcome={ok ? "ok" : "failed"}
      className="flex items-center gap-1"
    >
      <Icon
        aria-hidden
        className={`size-3.5 shrink-0 ${ok ? "text-success-600" : "text-destructive-600"}`}
      />
      {children}
    </span>
  );
}

/**
 * Connect dialog for Email (artboard 2A): the address with the recognised university or the manual form, the
 * password, the IMAP and SMTP check, and the folders nunio may read. Nothing is stored until "Verbinden".
 */
export function EmailConnectDialog({
  apiOrigin,
  dataNote,
}: {
  apiOrigin: string;
  /** Where the vendor processes data, from the catalog. */
  dataNote: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  // The address nunio last looked up, once the student left the field.
  const [discoveredFor, setDiscoveredFor] = useState("");
  const [password, setPassword] = useState("");
  const [changeServers, setChangeServers] = useState(false);
  const [servers, setServers] = useState(noServers);
  const [username, setUsername] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const id = useId();

  const discovery = useQuery({
    ...emailDiscoveryQuery(apiOrigin, discoveredFor),
    enabled: discoveredFor !== "",
  });
  const test = useMutation({
    ...emailTestMutation(apiOrigin),
    onSuccess: (folders) =>
      setSelected(folders.filter((f) => f.preselected).map((f) => f.path)),
  });
  const connect = useMutation({
    ...emailConnectMutation(apiOrigin),
    // Back to testing: the mailbox no longer passed, or the Connection couldn't be saved.
    onError: () => test.reset(),
    onSuccess: async () => {
      await queryClient.invalidateQueries(integrationQueries(apiOrigin));
      setOpen(false);
    },
  });

  const recognised =
    discovery.data?.status === "recognised" ? discovery.data : null;
  const manual = discovery.data?.status === "unknown" || changeServers;
  const discovered =
    discoveredFor === address &&
    discovery.isSuccess &&
    discovery.data.status !== "unsupported";
  const folders = test.data;
  const refusal = connect.error ?? test.error;
  const failedStep =
    refusal instanceof MailboxRefused &&
    refusal.refusal.error === "login_failed"
      ? refusal.refusal.step
      : null;
  const pending = test.isPending || connect.isPending;

  /** Any change to what was tested means testing again. */
  function edited() {
    test.reset();
    connect.reset();
  }

  function reset() {
    setAddress("");
    setDiscoveredFor("");
    setPassword("");
    setChangeServers(false);
    setServers(noServers);
    setUsername("");
    setSelected([]);
    edited();
  }

  function login(): EmailLogin {
    if (!manual) return { address, password };
    return {
      address,
      password,
      ...(username.trim() && { username: username.trim() }),
      servers: {
        imap: { host: servers.imapHost.trim(), port: Number(servers.imapPort) },
        smtp: { host: servers.smtpHost.trim(), port: Number(servers.smtpPort) },
      },
    };
  }

  const serverField = (
    key: keyof typeof noServers,
    label: string,
    type: "text" | "number",
  ) => (
    <Field className="min-w-0">
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        type={type}
        value={servers[key]}
        onChange={(event) => {
          setServers({ ...servers, [key]: event.target.value });
          edited();
        }}
      />
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        Verbinden
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>E-Mail verbinden</DialogTitle>
          <DialogDescription>
            nunio liest Mails aus den Ordnern, die du auswählst, und sendet nur,
            nachdem du zugestimmt hast.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id={`${id}-form`}
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              if (folders) connect.mutate({ ...login(), folders: selected });
              else if (discovered && password) test.mutate(login());
            }}
          >
            <FieldGroup className="gap-4.5">
              <Field>
                <FieldLabel htmlFor={`${id}-address`}>
                  E-Mail-Adresse
                </FieldLabel>
                <Input
                  id={`${id}-address`}
                  type="email"
                  autoComplete="email"
                  value={address}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    setChangeServers(false);
                    setServers(noServers);
                    edited();
                  }}
                  onBlur={() => setDiscoveredFor(address.trim())}
                />
                {discoveredFor === address && recognised && !changeServers && (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs leading-4 text-base-600">
                    <Check
                      aria-hidden
                      className="size-3.5 shrink-0 text-success-600"
                    />
                    <span>
                      {recognised.university} erkannt · {recognised.imap.host}
                    </span>
                    <button
                      type="button"
                      className="cursor-pointer text-primary-600 hover:underline"
                      onClick={() => {
                        setServers({
                          imapHost: recognised.imap.host,
                          imapPort: String(recognised.imap.port),
                          smtpHost: recognised.smtp.host,
                          smtpPort: String(recognised.smtp.port),
                        });
                        setChangeServers(true);
                        edited();
                      }}
                    >
                      Server ändern
                    </button>
                  </p>
                )}
                {discoveredFor === address &&
                  discovery.data?.status === "unsupported" && (
                    <p className="text-xs leading-4 text-destructive-700">
                      Diese Uni-Mail kann nunio noch nicht verbinden.
                    </p>
                  )}
                {discovery.isError && (
                  <p
                    role="alert"
                    className="text-xs leading-4 text-destructive-700"
                  >
                    Die Adresse konnte nicht geprüft werden. Bitte versuche es
                    erneut.
                  </p>
                )}
              </Field>
              {discoveredFor === address && manual && (
                <div className="flex flex-col gap-3">
                  {discovery.data?.status === "unknown" && (
                    <p className="text-xs leading-4 text-base-600">
                      nunio kennt die Server dieser Adresse nicht. Trag sie hier
                      ein.
                    </p>
                  )}
                  <div className="grid grid-cols-[1fr_6rem] gap-3">
                    {serverField("imapHost", "IMAP-Server", "text")}
                    {serverField("imapPort", "IMAP-Port", "number")}
                    {serverField("smtpHost", "SMTP-Server", "text")}
                    {serverField("smtpPort", "SMTP-Port", "number")}
                  </div>
                  <Field>
                    <FieldLabel htmlFor={`${id}-username`}>
                      Benutzername
                    </FieldLabel>
                    <Input
                      id={`${id}-username`}
                      autoComplete="username"
                      placeholder={address}
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value);
                        edited();
                      }}
                    />
                    <FieldDescription className="text-xs leading-4">
                      Nur nötig, wenn er nicht deine Adresse ist.
                    </FieldDescription>
                  </Field>
                </div>
              )}
              <Field>
                <FieldLabel htmlFor={`${id}-password`}>Passwort</FieldLabel>
                <Input
                  id={`${id}-password`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    edited();
                  }}
                />
                <FieldDescription className="text-xs leading-4">
                  Dein Uni-Passwort für E-Mail. nunio speichert es
                  verschlüsselt.
                </FieldDescription>
              </Field>
              {folders && (
                <div
                  role="status"
                  aria-label="Anmeldung geprüft"
                  className="flex flex-wrap items-center gap-4 rounded-lg bg-success-50 px-3 py-2.5 text-[13px] leading-4.5 text-success-800"
                >
                  <span className="font-medium">Anmeldung geprüft</span>
                  <Step ok>Lesen (IMAP)</Step>
                  <Step ok>Senden (SMTP)</Step>
                </div>
              )}
              {failedStep && (
                <div
                  role="alert"
                  aria-label="Anmeldung fehlgeschlagen"
                  className="flex flex-col gap-1.5 rounded-lg bg-destructive-50 px-3 py-2.5 text-[13px] leading-4.5 text-destructive-800"
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="font-medium">
                      Anmeldung fehlgeschlagen
                    </span>
                    <Step ok={failedStep !== "imap"}>Lesen (IMAP)</Step>
                    {failedStep === "smtp" && (
                      <Step ok={false}>Senden (SMTP)</Step>
                    )}
                  </div>
                  <p>
                    {failedStep === "imap"
                      ? "Lesen (IMAP) hat nicht geklappt. Prüfe Passwort, Benutzername und Server."
                      : "Senden (SMTP) hat nicht geklappt. Prüfe den SMTP-Server."}
                  </p>
                </div>
              )}
              {refusal && !failedStep && (
                <p role="alert" className="text-sm text-destructive-700">
                  {refusalMessage(refusal)}
                </p>
              )}
              {folders && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm leading-5 font-medium text-base-800">
                    Ordner, die nunio lesen darf
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {folders.map((folder) => {
                      const pressed = selected.includes(folder.path);
                      return (
                        <button
                          key={folder.path}
                          type="button"
                          aria-pressed={pressed}
                          onClick={() =>
                            setSelected(
                              pressed
                                ? selected.filter(
                                    (path) => path !== folder.path,
                                  )
                                : [...selected, folder.path],
                            )
                          }
                          className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-4 font-medium outline-1 focus-visible:outline-2 focus-visible:outline-primary-500 ${
                            pressed
                              ? "bg-primary-50 text-primary-700 outline-primary-300"
                              : "text-base-600 outline-base-300 hover:bg-base-50"
                          }`}
                        >
                          {pressed && (
                            <Check
                              aria-hidden
                              className="size-3 text-primary-600"
                            />
                          )}
                          {folderLabel(folder)}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </FieldGroup>
          </form>
        </DialogBody>
        <DialogFooter className="flex-col items-stretch gap-3.5 sm:flex-col">
          <div className="flex flex-col gap-0.5 text-xs leading-4 text-base-600">
            <p>{dataNote}.</p>
            <p>
              Was nunio liest, geht ohne Speicherung beim Anbieter an das
              KI-Modell.
            </p>
            <p>
              nunio speichert es verschlüsselt, bis du den Chat löschst oder die
              Verbindung trennst.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose
              render={<Button variant="outline" disabled={pending} />}
            >
              Abbrechen
            </DialogClose>
            {folders ? (
              <Button
                type="submit"
                form={`${id}-form`}
                disabled={pending || selected.length === 0}
                aria-busy={connect.isPending}
              >
                Verbinden
              </Button>
            ) : (
              <Button
                type="submit"
                form={`${id}-form`}
                disabled={pending || !discovered || !password}
                aria-busy={test.isPending}
              >
                Anmeldung prüfen
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
