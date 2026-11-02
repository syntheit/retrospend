import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { showAlert } from "@/ui/alert";
import { useToast } from "@/ui/Toast";
import {
	inputOf,
	type MethodInput,
	type PaymentMethod,
	preferred,
	without,
} from "./source";

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
