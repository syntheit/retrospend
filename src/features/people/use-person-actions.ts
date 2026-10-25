"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { PersonTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useEntryActions } from "~/features/entry/entry-actions";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import type { PersonIdentityDTO } from "./types";

export const personHrefOf = (p: PersonIdentityDTO) =>
	`/people/${p.type}/${p.id}`;

/**
 * The person entity's handlers for one person (R8): an action without a
 * handler is not offered, so Settle up shows only with an open balance and
 * Remind only when they owe you and can get a reminder. "Request" was the
 * same server call as Remind and is not offered (mockup round 1).
 */
export function usePersonActions(onSettle: (p: PersonIdentityDTO) => void) {
	const t = useTranslations("peoplePage.actions");
	const toast = useToast();
	const router = useRouter();
	const { openNewExpense } = useEntryActions();
	const remind = api.settlement.requestPayment.useMutation();

	const runRemind = useCallback(
		(p: PersonIdentityDTO) =>
			remind
				.mutateAsync({ participantType: p.type, participantId: p.id })
				.then(() => toast.saved(t("reminded", { name: p.name })))
				.catch((e: unknown) =>
					toast.failed(e instanceof Error ? e.message : t("failed")),
				),
		[remind, toast, t],
	);

	return useCallback(
		(
			p: PersonIdentityDTO,
			state: { open: boolean; owesYou: boolean },
		): ActionHandlers<PersonTarget> => ({
			...(state.open ? { settle: () => onSettle(p) } : {}),
			...(state.owesYou && p.onRetrospend
				? { remind: () => void runRemind(p) }
				: {}),
			addExpense: () => openNewExpense(),
			profile: () => router.push(personHrefOf(p)),
		}),
		[onSettle, runRemind, openNewExpense, router],
	);
}
