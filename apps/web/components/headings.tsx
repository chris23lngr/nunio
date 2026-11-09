import type { ComponentProps } from "react";

export function PageHeading({
  className = "",
  ...props
}: ComponentProps<"h1">) {
  return (
    <h1
      className={`text-3xl leading-12 font-medium text-base-800 sm:text-4xl ${className}`}
      {...props}
    />
  );
}
