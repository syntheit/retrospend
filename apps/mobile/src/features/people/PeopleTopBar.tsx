import { useState } from "react";
import { useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { AddPersonSheet } from "./AddPersonSheet";

/**
 * The top bar of People: the page's title, Add person as a plain icon, and
 * the account button. Add person opens a sheet for a name and an optional
 * email.
 */
export function PeopleTopBar({ title }: { title: string }) {
	const t = useTranslations("mobile.people.add");
	const [adding, setAdding] = useState(false);
	return (
		<>
			<AccountTopBar
				actions={[
					{
						id: "add-person",
						icon: "UserPlus",
						label: t("title"),
						onPress: () => setAdding(true),
					},
				]}
				title={title}
			/>
			<AddPersonSheet onClose={() => setAdding(false)} visible={adding} />
		</>
	);
}
