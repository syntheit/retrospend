import "server-only";

import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";
import { PeopleUnavailable } from "~/features/people/people-states";
import { dayKey } from "~/lib/time-zone";
import { api } from "~/trpc/server";
import { PersonScreen } from "./person-screen";

const TYPES = ["user", "guest", "shadow"] as const;
type Kind = (typeof TYPES)[number];
const isKind = (t: string): t is Kind =>
	(TYPES as readonly string[]).includes(t);

/**
 * The redesigned Person page (uiV2). The server reads people.page and hands
 * the client Money DTOs only; mutations refresh this read.
 */
export async function PersonPage({ type, id }: { type: string; id: string }) {
	if (!isKind(type)) notFound();
	let page: Awaited<ReturnType<typeof api.people.page>>;
	try {
		page = await api.people.page({ participantType: type, participantId: id });
	} catch (error) {
		if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
		console.error("[person] the page could not load", error);
		return <PeopleUnavailable />;
	}
	return <PersonScreen page={page} today={dayKey(new Date())} />;
}
