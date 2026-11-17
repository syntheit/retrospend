import { createRetrospendClient } from "@retrospend/api-client";
import {
	createDeviceEngine,
	type DeviceApi,
	type DeviceEngine,
} from "@retrospend/engine/device";
import {
	DeviceError,
	type DeviceErrorCode,
	type Envelope,
	type Reply,
	type Results,
} from "./protocol";

/** What the worker's global scope offers the host: a message port. */
export interface HostScope {
	postMessage(message: unknown): void;
	onmessage: ((event: { data: unknown }) => void) | null;
}

/** The engine's api, and the one call that says whose cookie it is riding on. */
export type HostApi = DeviceApi & {
	profile: { get(): Promise<{ id: string }> };
};

export interface HostDeps {
	/** The api for one engine; `fetch` is the one to give the client, which watches what the server answers. */
	createApi: (fetch: typeof globalThis.fetch) => HostApi;
	fetch: typeof globalThis.fetch;
	warn: (what: string, detail?: string) => void;
	now?: () => number;
}

/** The api over the same-origin cookie session: the web needs no token header. */
export const sameOriginApi = (
	origin: string,
	fetch: typeof globalThis.fetch,
): HostApi => createRetrospendClient({ baseUrl: origin, fetch });

/** The fixed code for what the server answered, or null for an answer that needs none. */
async function codeOf(response: Response): Promise<DeviceErrorCode | null> {
	if (response.status === 401) return "unauthenticated";
	if (response.status === 429) return "rate_limited";
	if (response.status !== 403) return null;
	try {
		const body = (await response.clone().json()) as { code?: unknown };
		return body.code === "protected_account"
			? "protected_account"
			: "forbidden";
	} catch {
		return "forbidden";
	}
}

const isIds = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((id) => typeof id === "string");

/**
 * The worker's side: one in-memory engine for one account, driven by
 * messages. Memory only on purpose: the web keeps no disk copy in this slice.
 * What the server refuses for good (a protected account, no session) ends the
 * engine, and every later call answers with the same code.
 */
export function attachHost(scope: HostScope, deps: HostDeps): void {
	let engine: DeviceEngine | null = null;
	let api: HostApi | null = null;
	/** The account the engine was started for. */
	let accountId = "";
	let terminal: DeviceErrorCode | null = null;
	/** What the server answered during the current call, if it needs a code. */
	let observed: DeviceErrorCode | null = null;

	const watchedFetch: typeof globalThis.fetch = async (input, init) => {
		const response = await deps.fetch(input, init);
		const code = await codeOf(response);
		if (code) observed = code;
		return response;
	};

	async function end(): Promise<void> {
		const old = engine;
		engine = null;
		await old?.dispose({ wipe: true }).catch(() => undefined);
	}

	/**
	 * Runs one engine call, after checking the cookie still belongs to the
	 * account the engine was started for (another tab may have signed out and
	 * in as someone else; this call would then merge their rows into ours). A
	 * refusal the server gave during it is the answer, whatever the engine made
	 * of it. The server's answers are not tied to one call, so with calls
	 * overlapping, a refusal goes to the first to finish; a terminal one ends
	 * the engine, and the others then answer with the same code.
	 */
	async function guarded<T>(call: (e: DeviceEngine) => Promise<T>): Promise<T> {
		if (terminal) throw new DeviceError(terminal);
		const mine = engine;
		const caller = api;
		if (!mine || !caller) throw new DeviceError("not_started");
		let result: T | undefined;
		let failure: unknown = null;
		try {
			const { id } = await caller.profile.get();
			if (id !== accountId) observed = "account_changed";
			else if (!terminal) result = await call(mine);
		} catch (error) {
			failure = error;
		}
		// Cleared even when the call threw, so a refusal never lingers for the next.
		const seen = observed as DeviceErrorCode | null;
		observed = null;
		if (seen !== null && seen !== "rate_limited") terminal = seen;
		// Checked after the call too: an overlapping call may have ended the engine.
		const code = terminal ?? seen;
		if (code) {
			if (terminal) await end();
			throw new DeviceError(code);
		}
		if (failure) throw failure;
		return result as T;
	}

	const handlers: {
		[K in keyof Results]: (
			request: Extract<Envelope, { type: K }>,
		) => Promise<Results[K]>;
	} = {
		async start(request) {
			if (typeof request.userId !== "string" || !request.userId)
				throw new DeviceError("bad_request");
			await end();
			terminal = null;
			api = deps.createApi(watchedFetch);
			accountId = request.userId;
			engine = createDeviceEngine(api, request.userId, deps.now, {
				warn: deps.warn,
			});
			return undefined;
		},
		pull: () =>
			guarded(async (e) => {
				await e.pullIfStale();
				return { status: e.status, generation: e.generation };
			}),
		read(request) {
			if (!isIds(request.ids)) throw new DeviceError("bad_request");
			return guarded((e) => e.read(request.ids));
		},
		verify(request) {
			if (!isIds(request.ids)) throw new DeviceError("bad_request");
			return guarded(async (e) => {
				await e.verify(request.ids);
				const parity = e.lastParity;
				return parity
					? {
							mismatchedIds: parity.mismatches.map((m) => m.id),
							generation: parity.generation,
						}
					: null;
			});
		},
		async stop() {
			terminal = null;
			await end();
			return undefined;
		},
	};

	scope.onmessage = async ({ data }) => {
		const request = data as Envelope;
		const id = typeof request?.id === "number" ? request.id : -1;
		const reply = (message: Reply) => scope.postMessage(message);
		try {
			const handler = handlers[request?.type] as
				| ((r: Envelope) => Promise<unknown>)
				| undefined;
			if (!handler) throw new DeviceError("bad_request");
			reply({ id, ok: true, value: await handler(request) });
		} catch (error) {
			// Only a fixed code leaves: an engine or network error may hold a name or an amount.
			reply({
				id,
				ok: false,
				code: error instanceof DeviceError ? error.code : "unavailable",
			});
		}
	};
}
