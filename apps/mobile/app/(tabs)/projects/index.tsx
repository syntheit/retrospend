import { Redirect } from "expo-router";
import { useTranslations } from "use-intl";
import { ProjectsList } from "@/features/projects/ProjectsList";
import { ProjectsTopBar } from "@/features/projects/ProjectsTopBar";
import { PROJECTS_APART } from "@/layout/destinations";

/** iPad: the Projects destination. Phones: a link here opens the Projects segment of People. */
export default function ProjectsScreen() {
	const t = useTranslations("mobile.projects");
	if (!PROJECTS_APART) {
		return (
			<Redirect
				href={{ pathname: "/people", params: { segment: "projects" } }}
			/>
		);
	}
	return <ProjectsList bar={<ProjectsTopBar title={t("title")} />} />;
}
