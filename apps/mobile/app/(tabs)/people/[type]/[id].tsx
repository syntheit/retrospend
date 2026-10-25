import { useLocalSearchParams } from "expo-router";
import { PersonView } from "@/features/people/PersonView";
import type { ParticipantType } from "@/features/people/source";

export default function PersonScreen() {
	const { type, id } = useLocalSearchParams<{
		type: ParticipantType;
		id: string;
	}>();
	return <PersonView person={{ type, id }} />;
}
