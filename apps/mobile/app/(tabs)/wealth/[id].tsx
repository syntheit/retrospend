import { useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { useHideAddButton } from "@/features/entry/addEntryContext";
import { AccountView } from "@/features/wealth/AccountView";

export default function WealthAccountScreen() {
	// Android: a pushed detail page has no floating add button; iOS keeps it.
	useHideAddButton(Platform.OS === "android");
	const { id } = useLocalSearchParams<{ id: string }>();
	return <AccountView id={id} />;
}
