import { useLocalSearchParams } from "expo-router";
import { SharedScreen } from "@/features/projects/shared/SharedScreen";

export default function SharedProjectRoute() {
	const { id, invite, guestResume, server, name } = useLocalSearchParams<{
		id: string;
		invite?: string;
		guestResume?: string;
		server?: string;
		name?: string;
	}>();
	return (
		<SharedScreen
			id={id}
			invite={invite ?? null}
			name={name}
			resume={guestResume ?? null}
			server={server ?? null}
		/>
	);
}
