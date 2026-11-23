import { redirect } from "next/navigation";
import { HomeScreen } from "@/features/home/home-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <HomeScreen apiOrigin={apiOrigin()} />;
}
