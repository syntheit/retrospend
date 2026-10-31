import { Redirect } from "expo-router";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";

/**
 * The app opens on Home when signed in, on sign-in when a server is saved,
 * and on connect when none is. While either is still being read it shows
 * nothing (the splash covers it): redirecting then would flash sign-in.
 */
export default function Index() {
	const { connection } = useServerConnection();
	const { state } = useSession();
	if (connection.status === "loading") return null;
	if (connection.status !== "connected") return <Redirect href="/connect" />;
	if (state.status === "loading") return null;
	return <Redirect href={state.status === "signedIn" ? "/home" : "/sign-in"} />;
}
