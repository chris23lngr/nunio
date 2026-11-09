export function sessionDevice(userAgent: string | null | undefined) {
  const agent = userAgent ?? "";
  const systems: [RegExp, string][] = [
    [/iPhone|iPad|iPod/, "iOS"],
    [/Android/, "Android"],
    [/Windows/, "Windows"],
    [/Macintosh/, "macOS"],
    [/CrOS/, "ChromeOS"],
    [/Linux/, "Linux"],
  ];
  const browsers: [RegExp, string][] = [
    [/Edg\/|EdgiOS\/|EdgA\//, "Edge"],
    [/OPR\//, "Opera"],
    [/Chrome\/|CriOS\//, "Chrome"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/Safari\//, "Safari"],
  ];
  const name =
    systems.find(([pattern]) => pattern.test(agent))?.[1] ??
    "Unbekanntes Gerät";
  const browser = browsers.find(([pattern]) => pattern.test(agent))?.[1];
  return { name, browser, mobile: name === "iOS" || name === "Android" };
}
