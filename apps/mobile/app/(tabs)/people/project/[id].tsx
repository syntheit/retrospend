import { useLocalSearchParams } from "expo-router";
import { useHideAddButtonOnDetail } from "@/features/entry/addEntryContext";
import { ProjectView } from "@/features/projects/ProjectView";
import { startOf } from "@/features/projects/projectActions";

/** A project opened from the Projects segment of People (phones). */
export default function PeopleProjectScreen() {
	useHideAddButtonOnDetail();
	const { id, name, settle, add, sheet } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
		add?: string;
		sheet?: string;
	}>();
	return (
		<ProjectView
			id={id}
			name={name}
			startAdding={add === "person"}
			startSettling={settle === "1"}
			startWith={startOf(sheet)}
		/>
	);
}
