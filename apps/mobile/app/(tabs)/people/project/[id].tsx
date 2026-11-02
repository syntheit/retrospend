import { useLocalSearchParams } from "expo-router";
import { useHideAddButtonOnDetail } from "@/features/entry/addEntryContext";
import { ProjectView } from "@/features/projects/ProjectView";

/** A project opened from the Projects segment of People (phones). */
export default function PeopleProjectScreen() {
	useHideAddButtonOnDetail();
	const { id, name, settle, add, link, invite } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
		add?: string;
		link?: string;
		invite?: string;
	}>();
	return (
		<ProjectView
			fromLink={link === "1"}
			id={id}
			invite={invite}
			name={name}
			startAdding={add === "person"}
			startSettling={settle === "1"}
		/>
	);
}
