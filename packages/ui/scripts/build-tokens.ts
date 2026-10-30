// Generates src/styles/tokens.css from docs/notion-spec/raw-tokens.txt.
// Run with `bun run tokens` after re-extracting values from Notion.

const SOURCE = new URL("../docs/notion-spec/raw-tokens.txt", import.meta.url)
const TARGET = new URL("../src/styles/tokens.css", import.meta.url)

type Theme = Map<string, string>

function parse(text: string): { light: Theme; dark: Theme } {
  const light: Theme = new Map()
  const dark: Theme = new Map()
  for (const line of text.split("\n")) {
    const match = line.match(/^([ld]) (.+)$/)
    if (!match) continue
    const [, theme, body] = match as [string, "l" | "d", string]
    // Values may contain spaces (shadows), so split only before `key=`
    for (const pair of body.split(/ (?=[A-Za-z0-9]+=)/)) {
      const eq = pair.indexOf("=")
      ;(theme === "l" ? light : dark).set(pair.slice(0, eq), pair.slice(eq + 1))
    }
  }
  return { light, dark }
}

const COLORS = {
  gra: "gray",
  bro: "brown",
  ora: "orange",
  yel: "yellow",
  gre: "green",
  blu: "blue",
  pur: "purple",
  pin: "pink",
  red: "red",
  tea: "teal",
} as const

const LEVELS = {
  Pri: "primary",
  Sec: "secondary",
  Ter: "tertiary",
  Dis: "disabled",
  Str: "strong",
  Int: "interactive",
  Ele: "elevated",
  AccPri: "accent",
  AccSec: "accent-secondary",
  InvPri: "inverse",
  InvSec: "inverse-secondary",
} as const

// Tailwind resolves text-*, bg-* and border-* from these namespaces before --color-*
const ROLES = {
  tex: "--text-color",
  ico: "--text-color-icon",
  bac: "--background-color",
  bor: "--border-color",
} as const

const ONE_OFFS: Record<string, string> = {
  staHov: "--background-color-hover",
  staPre: "--background-color-pressed",
  hovDisBac: "--background-color-hover-disabled",
  butHovBac: "--background-color-button-hover",
  butPreBac: "--background-color-button-pressed",
  butPreBacLig: "--background-color-button-pressed-light",
  outButHovBac: "--background-color-outline-button-hover",
  outButPreBac: "--background-color-outline-button-pressed",
  bluButHovBac: "--background-color-blue-button-hover",
  bluButPreBac: "--background-color-blue-button-pressed",
  whiButBac: "--background-color-white-button",
  whiButHovBac: "--background-color-white-button-hover",
  whiButPreBac: "--background-color-white-button-pressed",
  ligGraButHovBac: "--background-color-light-gray-button-hover",
  ligGraButPreBac: "--background-color-light-gray-button-pressed",
  popBac: "--background-color-popover",
  // ⌘K surface, drawn over a 40px backdrop blur (docs/notion-spec/components/command.md)
  popWaxPapBac: "--background-color-popover-frosted",
  modUndBac: "--background-color-overlay",
  popOveBac: "--background-color-popover-overlay",
  sidSecBac: "--background-color-sidebar",
  sidIteSelBac: "--background-color-sidebar-item-selected",
  // Sidebar page icons and the Shared empty action (docs/notion-spec/components/sidebar.md)
  sidSecCol: "--text-color-sidebar",
  tabRowHovBac: "--background-color-table-row-hover",
  tokInpMenIteBac: "--background-color-token-input-item",
  codBloBac: "--background-color-code-block",
  assCorButBac: "--background-color-assistant-button",
  assCorButBacHov: "--background-color-assistant-button-hover",
  assCorButBacPre: "--background-color-assistant-button-pressed",
  swiTogDesTraBg: "--background-color-switch-track",
  swiButTeaBg: "--background-color-switch",
  butBoxSha: "--shadow-button",
  focSha: "--shadow-focus",
  inpBluFocRin: "--shadow-focus-input",
  inpRedFocRin: "--shadow-focus-input-error",
  butBluFocRin: "--shadow-focus-button",
  shaOutSm: "--shadow-sm",
  shaOutMd: "--shadow-md",
  shaOutLg: "--shadow-lg",
  shaOutDif: "--shadow-diffuse",
  shaOutScr: "--shadow-screen",
  shaBasSm: "--shadow-base-sm",
  shaBasMd: "--shadow-base-md",
  shaBasLg: "--shadow-base-lg",
  shaBasDif: "--shadow-base-diffuse",
  shaBasScr: "--shadow-base-screen",
  shaSMThiOut: "--shadow-sm-thick",
  shaMDPriOut: "--shadow-md-primary",
  shaMDThiOut: "--shadow-md-thick",
}

function themeName(key: string): string | undefined {
  if (key in ONE_OFFS) return ONE_OFFS[key]

  // Palette: palBlu500, palTraGra300, palUiBlu600
  const palette = key.match(
    /^pal(?<alpha>Tra)?(?<ui>Ui)?(?<short>[A-Z][a-z]{2})(?<step>\d+)$/,
  )?.groups
  if (palette) {
    const color =
      COLORS[palette.short?.toLowerCase() as keyof typeof COLORS] ?? undefined
    if (!color) return undefined
    return `--color-${palette.ui ? "ui-" : ""}${color}${palette.alpha ? "-alpha" : ""}-${palette.step}`
  }

  // Semantic: texSec, bluBacTerTra, graIcoAccPri
  const semantic = key.match(
    /^(?<short>gra|bro|ora|yel|gre|blu|pur|pin|red|tea)?(?<role>Tex|Ico|Bac|Bor|tex|ico|bac|bor)(?<level>AccPri|AccSec|InvPri|InvSec|Pri|Sec|Ter|Dis|Str|Int|Ele)(?<translucent>Tra)?$/,
  )?.groups
  if (semantic) {
    const namespace = ROLES[semantic.role?.toLowerCase() as keyof typeof ROLES]
    const short = semantic.short as keyof typeof COLORS | undefined
    const color = short ? `-${COLORS[short]}` : ""
    const level = LEVELS[semantic.level as keyof typeof LEVELS]
    return `${namespace}${color}-${level}${semantic.translucent ? "-translucent" : ""}`
  }

  return undefined
}

const { light, dark } = parse(await Bun.file(SOURCE).text())

const block = (selector: string, theme: Theme) =>
  `${selector} {\n${[...theme].map(([k, v]) => `  --n-${k}: ${v};`).join("\n")}\n}`

// Only keys that exist in light are mapped; dark-only keys have no light fallback
const mapped = [...light.keys()]
  .map((key) => [themeName(key), key] as const)
  .filter((entry): entry is readonly [string, string] => entry[0] !== undefined)
  .sort(([a], [b]) => a.localeCompare(b))

// Notion derives interaction states from a base token instead of storing them
// (docs/notion-spec/components/button.md). Alpha multiples get a percentage suffix,
// e.g. bg-interactive-translucent-200 is bacIntTra at twice its alpha.
const ALPHA_DERIVED: Record<string, number[]> = {
  bacIntTra: [150, 200],
  bacSecTra: [150, 200],
  bacTerTra: [150, 200],
  redBacSecTra: [150, 200],
  bluBacIntTra: [200],
}
// Lightness offsets for solid colors, named by the state that uses them
const LIGHTNESS_DERIVED: Record<string, Record<string, number>> = {
  bluBacAccPri: { hover: -5, pressed: -10 },
}
// Shadows Notion composes inline from a color token rather than storing
const SHADOW_DERIVED: Record<string, string> = {
  // Idle search input in menus (docs/notion-spec/components/dropdown-menu.md)
  "--shadow-input": "0 0 0 1px var(--n-borPriTra)",
  "--shadow-input-inset": "inset 0 0 0 1px var(--n-borPriTra)",
  // Dark tooltip chip; Notion writes these values inline, not as a token
  // (docs/notion-spec/components/tooltip.md)
  "--shadow-tooltip":
    "0 4px 12px -2px rgb(0 0 0 / 0.08), inset 0 0 0 1px rgb(255 255 255 / 0.05)",
}

const names = new Map(mapped.map(([name, key]) => [key, name]))
const derived = [
  ...Object.entries(ALPHA_DERIVED).flatMap(([key, percents]) =>
    percents.map(
      (percent) =>
        [
          `${names.get(key)}-${percent}`,
          `rgb(from var(--n-${key}) r g b / calc(alpha * ${percent / 100}))`,
        ] as const,
    ),
  ),
  ...Object.entries(LIGHTNESS_DERIVED).flatMap(([key, states]) =>
    Object.entries(states).map(
      ([state, offset]) =>
        [
          `${names.get(key)}-${state}`,
          `hsl(from var(--n-${key}) h s calc(l ${offset < 0 ? "-" : "+"} ${Math.abs(offset)}) / alpha)`,
        ] as const,
    ),
  ),
  ...Object.entries(SHADOW_DERIVED),
]

const css = `/* Generated by scripts/build-tokens.ts from docs/notion-spec/raw-tokens.txt. Do not edit. */

/* Raw Notion values. Dark overrides only what differs, like Notion itself. */
${block(":root", light)}

${block(".dark", dark)}

.dark {
  color-scheme: dark;
}

@theme inline {
  --color-*: initial;
  --shadow-*: initial;
  --color-white: #fff;
  --color-black: #000;
${mapped.map(([name, key]) => `  ${name}: var(--n-${key});`).join("\n")}

  /* Derived interaction states */
${derived.map(([name, value]) => `  ${name}: ${value};`).join("\n")}
}
`

await Bun.write(TARGET, css)
console.log(
  `tokens.css: ${light.size} light, ${dark.size} dark, ${mapped.length} mapped to theme`,
)
