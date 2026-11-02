import { type ReactElement, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { useExpensesExport } from "@/features/people/useExpensesExport";
import type { TopBarAction } from "@/ui/types";
import { openProject } from "./openProject";
import { ProjectSheet } from "./ProjectSheet";

/**
 * The top bar of Projects: the page's title, New project as a plain icon (in
 * the overflow on the iPad, where the toolbar already has the plus), the
 * overflow and the account button. New project opens a sheet for a name, a
 * note, a currency, an optional budget and who it is for; "With others" opens
 * the new project on Add person.
 */
export function ProjectsTopBar({
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
					...(search ? [search] : []),
					{
						id: "new-project",
						icon: "FolderPlus",
						label: t("newTitle"),
						onPress: () => setAdding(true),
					},
				]}
				footer={footer}
				overflow={overflow}
				overflowLabel={more}
				title={title}
			/>
			<ProjectSheet
				home={me?.defaultCurrency ?? me?.homeCurrency ?? "USD"}
				onClose={() => setAdding(false)}
				onCreated={(made, others) => openProject(made, { add: others })}
				project={null}
				visible={adding}
			/>
		</>
	);
}
