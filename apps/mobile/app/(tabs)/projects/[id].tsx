import { Redirect, useLocalSearchParams } from "expo-router";
import { ProjectView } from "@/features/projects/ProjectView";
import { PROJECTS_APART } from "@/layout/destinations";

export default function ProjectScreen() {
	const { id, settle } = useLocalSearchParams<{
		id: string;
		settle?: string;
	}>();
	// Phones keep projects inside the People tab.
	if (!PROJECTS_APART) {
		return (
			<Redirect
				href={{
					pathname: "/people/project/[id]",
					params: settle ? { id, settle } : { id },
				}}
			/>
		);
	}
	return <ProjectView id={id} startSettling={settle === "1"} />;
}
