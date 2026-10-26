import { useLocalSearchParams } from "expo-router";
import { ProjectView } from "@/features/projects/ProjectView";

/** A project opened from the Projects segment of People (phones). */
export default function PeopleProjectScreen() {
	const { id, settle } = useLocalSearchParams<{
		id: string;
		settle?: string;
	}>();
	return <ProjectView id={id} startSettling={settle === "1"} />;
}
