import Link from "next/link";
import { redirect } from "next/navigation";
import { apiOrigin, getSession } from "@/lib/session";
import { ReviewList } from "./review-list";
import { SeriesReview } from "./series-review";

export default async function ReviewPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Sources</Link>
      <ReviewList apiOrigin={apiOrigin()} />
      <SeriesReview apiOrigin={apiOrigin()} />
    </main>
  );
}
