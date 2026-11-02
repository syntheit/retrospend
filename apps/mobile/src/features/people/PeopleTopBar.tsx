import { type ReactElement, useState } from "react";
import { useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import type { TopBarAction } from "@/ui/types";
import { AddPersonSheet } from "./AddPersonSheet";
import { useExpensesExport } from "./useExpensesExport";

/**
 * The top bar of People: the page's title, Add person as a plain icon, and
 * the account button. Add person opens a sheet for a name and an optional
 * email.
 */
export function PeopleTopBar({
	title,
	search,
	footer,
}: {
	title: string;
	/** The list's Search icon, first in the bar. */
	search?: TopBarAction | null;
	/** Android's collapsing bar: the tabs pinned under it. */
	footer?: ReactElement;
}) {
	const t = useTranslations("mobile.people.add");
	const more = useTranslations("mobile.activity")("overflow");
	const overflow = useExpensesExport();
	const [adding, setAdding] = useState(false);
	return (
		<>
			<AccountTopBar
				actions={[
					...(search ? [search] : []),
					{
						id: "add-person",
						icon: "UserPlus",
						label: t("title"),
						onPress: () => setAdding(true),
					},
				]}
				footer={footer}
				overflow={overflow}
				overflowLabel={more}
				title={title}
			/>
			<AddPersonSheet onClose={() => setAdding(false)} visible={adding} />
		</>
	);
}
