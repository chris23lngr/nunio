import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-base-100 animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
