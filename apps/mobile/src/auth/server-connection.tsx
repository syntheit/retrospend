// Which server the app talks to. The base URL is kept in the platform
// keystore (expo-secure-store: iOS Keychain, Android Keystore, no Google
// services), next to where the bearer token will live once sign-in lands.
import * as SecureStore from "expo-secure-store";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

const SERVER_URL_KEY = "retrospend.serverUrl";

export type ServerConnection =
	| { status: "loading" }
	| { status: "none" }
	| { status: "connected"; baseUrl: string };

interface ServerConnectionValue {
	connection: ServerConnection;
	connect: (baseUrl: string) => Promise<void>;
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
		SecureStore.getItemAsync(SERVER_URL_KEY)
			.then((baseUrl) =>
				setConnection(
					baseUrl ? { status: "connected", baseUrl } : { status: "none" },
				),
			)
			// An unreadable keystore entry means connecting again, not a crash.
			.catch(() => setConnection({ status: "none" }));
	}, []);

	const connect = useCallback(async (baseUrl: string) => {
		await SecureStore.setItemAsync(SERVER_URL_KEY, baseUrl);
		setConnection({ status: "connected", baseUrl });
	}, []);

	const value = useMemo(() => ({ connection, connect }), [connection, connect]);
	return (
		<ServerConnectionContext.Provider value={value}>
			{children}
		</ServerConnectionContext.Provider>
	);
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
