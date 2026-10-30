import { useLocalSearchParams } from "expo-router";
import { ProjectView } from "@/features/projects/ProjectView";

/** A project opened from the Projects segment of People (phones). */
export default function PeopleProjectScreen() {
	const { id, name, settle } = useLocalSearchParams<{
		id: string;
		name?: string;
		settle?: string;
	}>();
	return <ProjectView id={id} name={name} startSettling={settle === "1"} />;
}
