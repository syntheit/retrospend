"use client";

import { useMemo } from "react";
import type { ActionHandlers, ActionTarget } from "~/components/actions/types";
import { useToast } from "~/components/ui/toast";

/** The action ids of each entity registry file, so every menu item shows. */
export const ACTION_IDS = {
	expense: [
		"review",
		"open",
		"edit",
		"askFix",
		"correct",
		"split",
		"category",
		"project",
		"duplicate",
		"delete",
	],
	person: ["settle", "request", "remind", "addExpense", "profile"],
	project: ["addExpense", "pin", "share", "settleAll", "archive"],
	account: ["updateBalance", "history", "edit", "archive"],
	recurring: ["confirm", "editAmount", "pause", "resume", "skip", "delete"],
	category: ["edit", "exclude", "include", "delete"],
	paymentMethod: [
		"edit",
		"makePrimary",
		"showPublic",
		"showContacts",
		"showSettlement",
		"moveUp",
		"moveDown",
		"remove",
	],
	apiKey: ["revoke"],
	device: ["disconnect"],
} as const;

/**
 * Gallery handlers: every action answers with a toast naming what it would
 * do, so the menus are complete without touching any data.
 */
export function useDemoHandlers<T extends ActionTarget>(
	ids: readonly string[],
): ActionHandlers<T> {
	const toast = useToast();
	return useMemo(
		() =>
			Object.fromEntries(
				ids.map((id) => [
					id,
					(target: T) => toast.info(`${id}: ${target.name}`),
				]),
			),
		[ids, toast],
	);
}
