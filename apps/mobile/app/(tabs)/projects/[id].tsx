import { Redirect, useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { useHideAddButton } from "@/features/entry/addEntryContext";
import { ProjectView } from "@/features/projects/ProjectView";
import { PROJECTS_APART } from "@/layout/destinations";

export default function ProjectScreen() {
	// Android: a pushed detail page has no floating add button; iOS keeps it.
	useHideAddButton(Platform.OS === "android");
	const { id, name, settle, add } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
		add?: string;
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
			startSettling={settle === "1"}
		/>
	);
}
