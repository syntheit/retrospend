import { useTranslations } from "use-intl";
import type { BudgetGroup } from "./source";

/** A group's name: the one the person gave it, else its role's word. */
export function useGroupName() {
	const t = useTranslations("mobile.budget.group");
	return (group: BudgetGroup) => group.name ?? t(group.role ?? "ungrouped");
}
