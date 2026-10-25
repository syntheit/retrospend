import { useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { PeopleHub } from "@/features/people/PeopleHub";
import { PeopleList } from "@/features/people/PeopleList";
import { PROJECTS_APART } from "@/layout/destinations";

/** Phones: People and Projects in one tab. iPad: People alone, Projects has its own destination. */
export default function PeopleScreen() {
	const t = useTranslations("mobile.people");
	if (!PROJECTS_APART) return <PeopleHub />;
	return (
		<>
			<AccountTopBar title={t("title")} />
			<PeopleList />
		</>
	);
}
