import { Redirect } from "expo-router";
import { useServerConnection } from "@/auth/server-connection";

/** The app opens on Home, or on connect when no server is saved yet. */
export default function Index() {
	const { connection } = useServerConnection();
	return (
		<Redirect href={connection.status === "connected" ? "/home" : "/connect"} />
	);
}
