import { useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { useExpensesExport } from "@/features/people/useExpensesExport";
import { ProjectSheet } from "./ProjectSheet";

/**
 * The top bar of Projects: the page's title, New project as a plain icon (in
 * the overflow on the iPad, where the toolbar already has the plus), the
 * overflow and the account button. New project opens a sheet for a name, a
 * currency and an optional budget.
 */
export function ProjectsTopBar({ title }: { title: string }) {
	const t = useTranslations("mobile.projects.form");
	const more = useTranslations("mobile.activity")("overflow");
	const overflow = useExpensesExport();
	const { state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const [adding, setAdding] = useState(false);
	return (
		<>
			<AccountTopBar
				actions={[
					{
						id: "new-project",
						icon: "FolderPlus",
						label: t("newTitle"),
						onPress: () => setAdding(true),
					},
				]}
				overflow={overflow}
				overflowLabel={more}
				title={title}
			/>
			<ProjectSheet
				home={me?.defaultCurrency ?? me?.homeCurrency ?? "USD"}
				onClose={() => setAdding(false)}
				project={null}
				visible={adding}
			/>
		</>
	);
}
