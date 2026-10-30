import { useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { useHideAddButton } from "@/features/entry/addEntryContext";
import { PersonView } from "@/features/people/PersonView";
import type { ParticipantType } from "@/features/people/source";

export default function PersonScreen() {
	// Android: a pushed detail page has no floating add button; iOS keeps it.
	useHideAddButton(Platform.OS === "android");
	const { type, id, settle } = useLocalSearchParams<{
		type: ParticipantType;
		id: string;
		settle?: string;
	}>();
	return <PersonView person={{ type, id }} startSettling={settle === "1"} />;
}
