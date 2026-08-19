import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/analysis")({
  component: () => <Outlet />,
});
