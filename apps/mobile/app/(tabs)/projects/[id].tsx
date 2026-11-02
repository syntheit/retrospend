import { Redirect, useLocalSearchParams } from "expo-router";
import { useHideAddButtonOnDetail } from "@/features/entry/addEntryContext";
import { startOf } from "@/features/projects/projectActions";
import { ProjectView } from "@/features/projects/ProjectView";
import { PROJECTS_APART } from "@/layout/destinations";

export default function ProjectScreen() {
	useHideAddButtonOnDetail();
	const { id, name, settle, add, then } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
		add?: string;
		then?: string;
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
						...(add ? { add } : {}),
						...(then ? { then } : {}),
					},
				}}
			/>
		);
	}
	return (
		<ProjectView
			id={id}
			name={name}
			startAdding={add === "person"}
			startWith={startOf(then)}
			startSettling={settle === "1"}
		/>
	);
}
