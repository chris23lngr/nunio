/**
 * Classes that tint an entry in its Course's color, read from `--tint`: set it to the
 * Course's swatch (`colors[color].swatch`). The theme drops Tailwind's palette, so the
 * shades are mixed from the swatch, the same source as the course dots.
 */
export const courseTint = {
  /** A Fixed Event of the Course: a strong fill. */
  fixed:
    "bg-[color-mix(in_oklab,var(--tint)_35%,white)] text-[color-mix(in_oklab,var(--tint),black_72%)]",
  /** A Study Block for the Course: a faint fill. */
  study:
    "bg-[color-mix(in_oklab,var(--tint)_10%,white)] text-[color-mix(in_oklab,var(--tint),black_72%)]",
  /** The ring around a selected entry. */
  ring: "ring-[color-mix(in_oklab,color-mix(in_oklab,var(--tint)_55%,white)_60%,transparent)]",
};
