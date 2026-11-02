import { useLocalSearchParams } from "expo-router";
import { useHideAddButtonOnDetail } from "@/features/entry/addEntryContext";
import { startOf } from "@/features/projects/projectActions";
import { ProjectView } from "@/features/projects/ProjectView";

/** A project opened from the Projects segment of People (phones). */
export default function PeopleProjectScreen() {
	useHideAddButtonOnDetail();
	const { id, name, settle, add, then } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
		add?: string;
		then?: string;
	}>();
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
