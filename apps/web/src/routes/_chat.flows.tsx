import { createFileRoute } from "@tanstack/react-router";
import { FlowsView } from "~/components/flows/FlowsView";
export const Route = createFileRoute("/_chat/flows")({ component: FlowsView });
