import type { MetadataRoute } from "next";

/** iOS shows push only to a web app added to the Home Screen with a standalone manifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "nunio",
    short_name: "nunio",
    start_url: "/",
    display: "standalone",
  };
}
