import { useTranslations } from "use-intl";
import { PeopleHub } from "@/features/people/PeopleHub";
import { PeopleList } from "@/features/people/PeopleList";
import { PeopleTopBar } from "@/features/people/PeopleTopBar";
import { PROJECTS_APART } from "@/layout/destinations";

/** Phones: People and Projects in one tab. iPad: People alone, Projects has its own destination. */
export default function PeopleScreen() {
	const t = useTranslations("mobile.people");
	if (!PROJECTS_APART) return <PeopleHub />;
	return <PeopleList bar={<PeopleTopBar title={t("title")} />} />;
}
