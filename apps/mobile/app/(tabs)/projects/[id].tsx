import { useLocalSearchParams } from "expo-router";
import { ProjectView } from "@/features/projects/ProjectView";

export default function ProjectScreen() {
	const { id, settle } = useLocalSearchParams<{
		id: string;
		settle?: string;
	}>();
	return <ProjectView id={id} startSettling={settle === "1"} />;
}
