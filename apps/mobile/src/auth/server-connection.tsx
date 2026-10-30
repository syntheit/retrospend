// Which server the app talks to. The base URL is kept in the platform
// keystore (expo-secure-store: iOS Keychain, Android Keystore, no Google
// services), next to where the bearer token will live once sign-in lands.

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { createSqliteStore } from "@/data/sqlite-store";
import { getErrorLog } from "@/features/feedback/runtime";
import { secureStore } from "@/lib/secure-store";
import { clearStaleServerOnFirstRun } from "./first-run";

const SERVER_URL_KEY = "retrospend.serverUrl";

export type ServerConnection =
	| { status: "loading" }
	| { status: "none" }
	| { status: "connected"; baseUrl: string };

interface ServerConnectionValue {
	connection: ServerConnection;
	connect: (baseUrl: string) => Promise<void>;
	/**
	 * Forgets the saved server so the connect screen shows. Sign out first:
	 * the session is kept per server and stays on this phone until then.
	 */
	disconnect: () => Promise<void>;
}

const ServerConnectionContext = createContext<ServerConnectionValue | null>(
	null,
);

export function ServerConnectionProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [connection, setConnection] = useState<ServerConnection>({
		status: "loading",
	});

	useEffect(() => {
		secureStore
			.getItemAsync(SERVER_URL_KEY)
			.then(async (baseUrl) => {
				// The Keychain outlives an uninstall, so a server saved by an earlier
				// install (a debug build) would stick. An unreadable marker keeps it.
				const stale =
					baseUrl !== null &&
					(await clearStaleServerOnFirstRun(createSqliteStore(), () =>
						secureStore.deleteItemAsync(SERVER_URL_KEY),
					).catch(() => false));
				setConnection(
					baseUrl && !stale
						? { status: "connected", baseUrl }
						: { status: "none" },
				);
			})
			// An unreadable keystore entry means connecting again, not a crash.
			.catch(() => setConnection({ status: "none" }));
	}, []);

	const connect = useCallback(async (baseUrl: string) => {
		await secureStore.setItemAsync(SERVER_URL_KEY, baseUrl);
		// The recorded errors belong to the server they were recorded against.
		await getErrorLog()
			.clear()
			.catch(() => undefined);
		setConnection({ status: "connected", baseUrl });
	}, []);

	const disconnect = useCallback(async () => {
		await secureStore.deleteItemAsync(SERVER_URL_KEY);
		await getErrorLog()
			.clear()
			.catch(() => undefined);
		setConnection({ status: "none" });
	}, []);

	const value = useMemo(
		() => ({ connection, connect, disconnect }),
		[connection, connect, disconnect],
	);
	return (
		<ServerConnectionContext.Provider value={value}>
			{children}
		</ServerConnectionContext.Provider>
	);
}

/**
 * The connected server's address, or null when none is connected (or there
 * is no provider, as in a test): pictures the server sends as paths load
 * from it.
 */
export function useServerBaseUrl(): string | null {
	const value = useContext(ServerConnectionContext);
	return value?.connection.status === "connected"
		? value.connection.baseUrl
		: null;
}

export function useServerConnection(): ServerConnectionValue {
	const value = useContext(ServerConnectionContext);
	if (!value) {
		throw new Error(
			"useServerConnection needs a ServerConnectionProvider above it",
		);
	}
	return value;
}
