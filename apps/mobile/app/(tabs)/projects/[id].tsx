import { Redirect, useLocalSearchParams } from "expo-router";
import { ProjectView } from "@/features/projects/ProjectView";
import { PROJECTS_APART } from "@/layout/destinations";

export default function ProjectScreen() {
	const { id, name, settle } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
	}>();
	// Phones keep projects inside the People tab.
	if (!PROJECTS_APART) {
		return (
			<Redirect
				href={{
					pathname: "/people/project/[id]",
					params: {
						id,
						...(name ? { name } : {}),
						...(settle ? { settle } : {}),
					},
				}}
			/>
		);
	}
	return <ProjectView id={id} name={name} startSettling={settle === "1"} />;
}
