import { Redirect } from "expo-router";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";

/**
 * The app opens on Home when signed in, on sign-in when a server is saved,
 * and on connect when none is.
 */
export default function Index() {
	const { connection } = useServerConnection();
	const { state } = useSession();
	if (connection.status !== "connected") return <Redirect href="/connect" />;
	return <Redirect href={state.status === "signedIn" ? "/home" : "/sign-in"} />;
}
