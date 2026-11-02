import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { showAlert } from "@/ui/alert";
import { type ActionDef, menuOf } from "@/ui/actionRegistry";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import {
	type MethodInput,
	type PaymentMethod,
	inputOf,
	preferred,
	without,
} from "./source";

/**
 * What can be done to a payment method, in one place: the row's long-press
 * menu and the method's sheet (its fields, Make primary, then the quiet
 * Remove) read this order, Remove last.
 */
export type MethodActionId = "edit" | "prefer" | "remove";

export const METHOD_ACTIONS: Record<MethodActionId, ActionDef<MethodActionId>> =
	{
		edit: { id: "edit", icon: "Pencil" },
		prefer: { id: "prefer" },
		remove: { id: "remove", icon: "Trash2", destructive: true },
	};

/** Make primary only for a method that is not the first already. */
export function methodActionsOf(method: Pick<PaymentMethod, "rank">) {
	return [
		"edit",
		...(method.rank === 1 ? [] : (["prefer"] as const)),
		"remove",
	] as MethodActionId[];
}

/**
 * The writes of a method from anywhere (its row or its sheet). Every change
 * sends the whole list (the server replaces it); Remove asks in a native
 * alert and ends in an Undo toast that sends the list back.
 */
export function useMethodWrites(
	all: readonly PaymentMethod[],
	onDone: () => void,
) {
	const t = useTranslations("mobile.settings.payment");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();

	async function replace(methods: MethodInput[]) {
		if (!api) return false;
		try {
			await api["payment-methods"].replace(
				{ methods },
				{ context: { idempotencyKey: newClientId() } },
			);
			return true;
		} catch {
			return false;
		}
	}

	return {
		async prefer(method: PaymentMethod, after?: () => void) {
			if (await replace(preferred(all, method.id))) {
				toast.show({ message: t("preferredToast") });
				onDone();
				after?.();
			} else toast.show({ message: t("saveError") });
		},
		remove(method: PaymentMethod, after?: () => void) {
			showAlert(t("removeTitle"), undefined, [
				{ text: tc("cancel"), style: "cancel" },
				{
					text: t("removeConfirm"),
					style: "destructive",
					onPress: () =>
						void (async () => {
							if (!(await replace(without(all, method.id)))) {
								toast.show({ message: t("saveError") });
								return;
							}
							toast.show({
								message: t("removed"),
								undo: {
									label: tc("undo"),
									onUndo: async () => {
										await replace(all.map(inputOf));
										onDone();
									},
								},
							});
							onDone();
							after?.();
						})(),
				},
			]);
		},
	};
}

/** The row's menu: Edit, Make primary, Remove. */
export function methodMenu(
	method: PaymentMethod,
	words: Record<MethodActionId, string>,
	run: Record<MethodActionId, () => void>,
): MenuItem[] {
	return menuOf(methodActionsOf(method), METHOD_ACTIONS, words, run);
}
