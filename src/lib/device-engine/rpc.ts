import {
	DeviceError,
	type DeviceErrorCode,
	type Envelope,
	type Reply,
	type Request,
	type Results,
} from "./protocol";

/** What the client needs of a Worker; a MessagePort pair stands in for one in tests. */
export interface WorkerLike {
	postMessage(message: unknown): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onmessageerror: ((event: unknown) => void) | null;
	terminate(): void;
}

export interface DeviceClient {
	start(userId: string): Promise<void>;
	pull(): Promise<Results["pull"]>;
	read(ids: readonly string[]): Promise<Results["read"]>;
	verify(ids: readonly string[]): Promise<Results["verify"]>;
	/** Checks the glance figures against the server, after a pull. */
	parity(): Promise<Results["parity"]>;
	stop(): Promise<void>;
	/** Ends the worker; every call still waiting rejects with worker_dead. */
	terminate(): void;
	readonly dead: boolean;
}

/** The page's side: a request id per call, so answers pair up in any order. */
export function createDeviceClient(worker: WorkerLike): DeviceClient {
	let nextId = 0;
	let dead = false;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: DeviceError) => void }
	>();

	const die = (code: DeviceErrorCode = "worker_dead") => {
		dead = true;
		for (const { reject } of pending.values()) reject(new DeviceError(code));
		pending.clear();
	};

	worker.onmessage = ({ data }) => {
		const reply = data as Reply;
		const waiting = pending.get(reply?.id);
		if (!waiting) return;
		pending.delete(reply.id);
		if (reply.ok) waiting.resolve(reply.value);
		else waiting.reject(new DeviceError(reply.code));
	};
	// An uncaught error or a message that cannot be read: the worker is no
	// longer trusted, so it is ended and nothing waits for it.
	const fail = () => {
		die();
		worker.terminate();
	};
	worker.onerror = fail;
	worker.onmessageerror = fail;

	function call<K extends Request["type"]>(
		request: Extract<Request, { type: K }>,
	): Promise<Results[K]> {
		if (dead) return Promise.reject(new DeviceError("worker_dead"));
		const id = nextId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			try {
				worker.postMessage({ ...request, id } satisfies Envelope);
			} catch {
				pending.delete(id);
				reject(new DeviceError("worker_dead"));
			}
		});
	}

	return {
		start: (userId) => call({ type: "start", userId }),
		pull: () => call({ type: "pull" }),
		read: (ids) => call({ type: "read", ids: [...ids] }),
		verify: (ids) => call({ type: "verify", ids: [...ids] }),
		parity: () => call({ type: "parity" }),
		stop: () => call({ type: "stop" }),
		terminate() {
			die();
			worker.terminate();
		},
		get dead() {
			return dead;
		},
	};
}
