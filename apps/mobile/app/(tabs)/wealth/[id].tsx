import { useLocalSearchParams } from "expo-router";
import { useHideAddButtonOnDetail } from "@/features/entry/addEntryContext";
import { AccountView } from "@/features/wealth/AccountView";

export default function WealthAccountScreen() {
	useHideAddButtonOnDetail();
	const { id } = useLocalSearchParams<{ id: string }>();
	return <AccountView id={id} />;
}
