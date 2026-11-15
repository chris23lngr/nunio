import { permanentRedirect } from "next/navigation";

/** Artifacts moved to /artifacts; old links and bookmarks still arrive. */
export default async function MovedArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/artifacts/${encodeURIComponent(id)}`);
}
