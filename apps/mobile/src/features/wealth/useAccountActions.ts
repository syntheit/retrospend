import { useCallback } from "react";
import { useTranslations } from "use-intl";
import type { SwipeAction } from "@/ui/SwipeRow";
import type { MenuItem } from "@/ui/types";
import {
	ACCOUNT_ICON,
	type AccountAction,
	type AccountRowActions,
	actionsOf,
	swipesOf,
} from "./actions";
import type { Account } from "./source";

/**
 * The menu and the swipes of an account row, worded. `run` is what a chosen
 * action does (usually: open its sheet). Delete is the only destructive one.
 */
export function useAccountActions(
	run: (action: AccountAction, account: Account) => void,
) {
	const t = useTranslations("mobile.wealth.actions");
	return useCallback(
		(account: Account): AccountRowActions => {
			const item = (action: AccountAction): MenuItem => ({
				id: action,
				label: t(action),
				icon: ACCOUNT_ICON[action],
				onPress: () => run(action, account),
				destructive: action === "delete",
			});
			const swipe = (action: AccountAction): SwipeAction => ({
				label: t(`swipe.${action}`),
				onPress: () => run(action, account),
				tone:
					action === "delete"
						? "danger"
						: action === "update" || action === "reopen"
							? "brand"
							: "neutral",
			});
			const swipes = swipesOf(account);
			return {
				menu: actionsOf(account).map(item),
				leading: swipe(swipes.leading),
				trailing: swipe(swipes.trailing),
			};
		},
		[run, t],
	);
}
