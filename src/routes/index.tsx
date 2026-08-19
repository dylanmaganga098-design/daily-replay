import { createFileRoute } from "@tanstack/react-router";
import Home from "@/pages/Home";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Data Analyser V1" },
      {
        name: "description",
        content:
          "Lets get this fucking bread",
      },
      { property: "og:title", content: "Data Analyser V1" },
      {
        property: "og:description",
        content:
          "Lets get this fucking bread",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});
