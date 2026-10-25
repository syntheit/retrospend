import { useLocalSearchParams } from "expo-router";
import { AccountView } from "@/features/wealth/AccountView";

export default function WealthAccountScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return <AccountView id={id} />;
}
