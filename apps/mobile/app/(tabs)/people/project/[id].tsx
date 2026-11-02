import { useLocalSearchParams } from "expo-router";
import { useHideAddButtonOnDetail } from "@/features/entry/addEntryContext";
import { ProjectView } from "@/features/projects/ProjectView";

/** A project opened from the Projects segment of People (phones). */
export default function PeopleProjectScreen() {
	useHideAddButtonOnDetail();
	const { id, name, settle, add } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
		add?: string;
	}>();
	return (
		<ProjectView
			id={id}
			name={name}
			startAdding={add === "person"}
			startSettling={settle === "1"}
		/>
	);
}
