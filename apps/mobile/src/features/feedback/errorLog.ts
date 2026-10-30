import {
	type ErrorReportInput,
	scrubErrorText,
	scrubScreen,
} from "@retrospend/api-contract";
import { newClientId } from "@/data/ids";
import type { KeyValueStore } from "@/data/store";

// A small ring of the app's own errors, kept on this phone. Nothing here
// leaves it unless the person turns on "Send error reports to my server" or
// includes diagnostics with feedback. Every message and stack is scrubbed
// before it is kept: no addresses, emails, tokens, ids or amounts.

const KEY = "retrospend.errorLog";
/** The newest errors kept; older ones fall off. */
export const ERROR_LOG_SIZE = 20;
/** The same error again within this long is one entry (a render loop). */
const DEDUPE_MS = 60_000;

export type ErrorKind = ErrorReportInput["kind"];

/** An entry and whether it has already gone to the server. */
export interface LoggedError extends ErrorReportInput {
	id: string;
	sent: boolean;
}

/** What the app knows about itself when an error happens. */
export interface ErrorContext {
	appVersion?: string;
	build?: string;
	os?: string;
	device?: string;
	/** The route the person was on. */
	screen?: string;
}

export interface ErrorLog {
	record(kind: ErrorKind, error: unknown): Promise<void>;
	/** The newest first, at most `limit`. */
	recent(limit?: number): Promise<LoggedError[]>;
	/** Entries not yet sent, oldest first. */
	unsent(): Promise<LoggedError[]>;
	markSent(ids: string[]): Promise<void>;
	clear(): Promise<void>;
	/** Called after each recorded entry; returns the way to stop. */
	subscribe(listener: () => void): () => void;
}

function textOf(error: unknown): { message: string; stack?: string } {
	if (error instanceof Error)
		return {
			message: `${error.name}: ${error.message}`,
			stack: error.stack,
		};
	if (typeof error === "string") return { message: error };
	try {
		return { message: JSON.stringify(error) ?? String(error) };
	} catch {
		return { message: "Unknown error" };
	}
}

function parse(raw: string | null): LoggedError[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? (value as LoggedError[]) : [];
	} catch {
		return [];
	}
}

export function createErrorLog(
	store: KeyValueStore,
	context: () => ErrorContext,
	now: () => Date = () => new Date(),
): ErrorLog {
	const listeners = new Set<() => void>();
	// Writes run one after another, so two errors in a row never overwrite each other.
	let chain: Promise<unknown> = Promise.resolve();
	const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
		const next = chain.then(work, work);
		chain = next.catch(() => undefined);
		return next;
	};
	const read = async () => parse(await store.get(KEY));
	const write = (entries: LoggedError[]) =>
		store.set(KEY, JSON.stringify(entries.slice(-ERROR_LOG_SIZE)));

	return {
		record: (kind, error) =>
			exclusive(async () => {
				const { message, stack } = textOf(error);
				const ctx = context();
				const entries = await read();
				const clean = scrubErrorText(message, 500);
				const last = entries[entries.length - 1];
				if (
					last &&
					last.kind === kind &&
					last.message === clean &&
					now().getTime() - new Date(last.occurredAt).getTime() < DEDUPE_MS
				)
					return;
				entries.push({
					id: newClientId(),
					sent: false,
					kind,
					message: clean,
					stack: stack ? scrubErrorText(stack, 4000) : undefined,
					screen: ctx.screen ? scrubScreen(ctx.screen) : undefined,
					appVersion: ctx.appVersion,
					build: ctx.build,
					os: ctx.os,
					device: ctx.device,
					occurredAt: now().toISOString(),
				});
				await write(entries);
				for (const listener of listeners) listener();
			}),
		recent: async (limit = ERROR_LOG_SIZE) =>
			(await exclusive(read)).slice(-limit).reverse(),
		unsent: async () => (await exclusive(read)).filter((e) => !e.sent),
		markSent: (ids) =>
			exclusive(async () => {
				const set = new Set(ids);
				await write(
					(await read()).map((e) => (set.has(e.id) ? { ...e, sent: true } : e)),
				);
			}),
		clear: () => exclusive(() => store.delete(KEY)),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/** The entry as the API takes it (the local id and sent flag stay behind). */
export function toReport(entry: LoggedError): ErrorReportInput {
	const { id: _id, sent: _sent, ...report } = entry;
	return report;
}
