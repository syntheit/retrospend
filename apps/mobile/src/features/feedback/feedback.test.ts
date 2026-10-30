import { createMemoryStore } from "@/data/store";
import { createErrorLog, ERROR_LOG_SIZE, toReport } from "./errorLog";
import { flushErrorReports } from "./flush";
import { installErrorHandlers, resetErrorHandlersForTest } from "./handlers";
import { buildFeedback, collectDiagnostics, diagnosticRows } from "./payload";
import { sendFeedback } from "./sendFeedback";

jest.mock("@/data/ids", () => {
	let n = 0;
	return { newClientId: () => `id-${++n}` };
});

const ctx = () => ({
	appVersion: "0.5.0",
	build: "7",
	os: "iOS 19",
	device: "iPhone15,4",
	screen: "/(tabs)/activity/clx9f2k3j0000abc123?tab=1",
});

describe("error log", () => {
	it("scrubs addresses, emails, tokens and amounts before keeping an error", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		await log.record(
			"crash",
			new Error(
				"POST https://me.example/api/v1/expenses failed for bob@example.com owing $1,234.50 with Bearer abc.def.ghi",
			),
		);
		const [entry] = await log.recent();
		expect(entry?.message).toBe(
			"Error: POST <url> failed for <email> owing <n> with Bearer <token>",
		);
		expect(entry?.screen).toBe("/(tabs)/activity/:id");
		expect(entry?.os).toBe("iOS 19");
		expect(JSON.stringify(entry)).not.toMatch(/me\.example|bob@|1,234/);
	});

	it("keeps only the newest entries and lists the newest first", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		for (let n = 0; n < ERROR_LOG_SIZE + 5; n++)
			await log.record(
				"crash",
				`problem ${String.fromCharCode(97 + (n % 26))}${n}x`,
			);
		const all = await log.recent();
		expect(all).toHaveLength(ERROR_LOG_SIZE);
		expect(all[0]?.message).toContain("x");
		expect((await log.recent(3)).map((e) => e.id)).toEqual(
			all.slice(0, 3).map((e) => e.id),
		);
	});

	it("counts the same error twice in a minute once", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		await log.record("render", new Error("boom"));
		await log.record("render", new Error("boom"));
		expect(await log.recent()).toHaveLength(1);
	});

	it("keeps writes made at the same moment", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		await Promise.all([
			log.record("crash", "first"),
			log.record("rejection", "second"),
			log.record("render", "third"),
		]);
		expect(await log.recent()).toHaveLength(3);
	});

	it("marks entries sent and drops the local fields from a report", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		await log.record("crash", "one");
		const [entry] = await log.unsent();
		expect(toReport(entry as never)).not.toHaveProperty("id");
		await log.markSent([entry?.id ?? ""]);
		expect(await log.unsent()).toEqual([]);
		expect(await log.recent()).toHaveLength(1);
	});
});

describe("global handlers", () => {
	beforeEach(resetErrorHandlersForTest);

	it("records an uncaught error and still runs the previous handler", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		const previous = jest.fn();
		let installed: ((e: unknown, fatal?: boolean) => void) | undefined;
		installErrorHandlers(log, {
			ErrorUtils: {
				getGlobalHandler: () => previous,
				setGlobalHandler: (h) => {
					installed = h;
				},
			},
		});
		installed?.(new Error("uncaught"), false);
		expect(previous).toHaveBeenCalledTimes(1);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((await log.recent())[0]?.kind).toBe("crash");
	});

	it("lets a fatal error reach the log before the previous handler runs", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		const previous = jest.fn(async () => {
			expect(await log.recent()).toHaveLength(1);
		});
		let installed: ((e: unknown, fatal?: boolean) => void) | undefined;
		installErrorHandlers(log, {
			ErrorUtils: {
				getGlobalHandler: () => previous,
				setGlobalHandler: (h) => {
					installed = h;
				},
			},
		});
		installed?.(new Error("fatal"), true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(previous).toHaveBeenCalledTimes(1);
	});

	it("records an unhandled promise rejection", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		let onUnhandled: ((id: number, e: unknown) => void) | undefined;
		installErrorHandlers(
			log,
			{
				HermesInternal: {
					enablePromiseRejectionTracker: (o) => {
						onUnhandled = o.onUnhandled;
					},
				},
			},
			false,
		);
		onUnhandled?.(1, new Error("nobody caught me"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((await log.recent())[0]).toMatchObject({
			kind: "rejection",
			message: "Error: nobody caught me",
		});
	});
});

describe("flush", () => {
	it("sends what is unsent in one batch and marks it sent", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		await log.record("crash", "a");
		await log.record("rejection", "b");
		const submitErrorReports = jest.fn(
			async (_input: { reports: unknown[] }) => ({
				ok: true,
				stored: 2,
			}),
		);
		const sent = await flushErrorReports(log, {
			feedback: { submitErrorReports },
		} as never);
		expect(sent).toBe(2);
		expect(submitErrorReports.mock.calls[0]?.[0].reports).toHaveLength(2);
		expect(await log.unsent()).toEqual([]);
		expect(
			await flushErrorReports(log, {
				feedback: { submitErrorReports },
			} as never),
		).toBe(0);
		expect(submitErrorReports).toHaveBeenCalledTimes(1);
	});

	it("keeps them for the next try when the server is unreachable", async () => {
		const log = createErrorLog(createMemoryStore(), ctx);
		await log.record("crash", "a");
		const failing = {
			feedback: {
				submitErrorReports: jest.fn(async () => {
					throw new Error("offline");
				}),
			},
		};
		expect(await flushErrorReports(log, failing as never)).toBe(0);
		expect(await log.unsent()).toHaveLength(1);
	});
});

describe("feedback body", () => {
	const facts = {
		appVersion: "0.5.0",
		build: "7",
		os: "iOS 19",
		device: "iPhone15,4",
	};

	it("without diagnostics carries the note, category and screen only", () => {
		const body = buildFeedback({
			message: "  It jumps  ",
			category: "bug",
			screen: "/(tabs)/activity/clx9f2k3j0000abc123",
			diagnostics: null,
			viewport: { width: 390, height: 844 },
		});
		expect(body).toEqual({
			message: "It jumps",
			category: "bug",
			pageUrl: "app:/(tabs)/activity/:id",
		});
	});

	it("with diagnostics adds the facts and the newest errors", () => {
		const d = collectDiagnostics({
			facts,
			locale: "es-AR",
			serverVersion: "0.5.0",
			recentErrors: Array.from({ length: 8 }, (_, i) => ({
				kind: "crash" as const,
				message: `m${i}`,
				occurredAt: "2026-10-30T10:00:00.000Z",
			})),
		});
		expect(d.recentErrors).toHaveLength(5);
		const body = buildFeedback({
			message: "x",
			category: "idea",
			diagnostics: d,
			viewport: { width: 390.4, height: 844 },
		});
		expect(body.appVersion).toBe("0.5.0");
		expect(body.userAgent).toBe("Retrospend/0.5.0 (iOS 19; iPhone15,4)");
		expect(body.viewportSize).toBe("390x844");
		expect(diagnosticRows(d)).toEqual([
			{ key: "app", value: "0.5.0 (7)" },
			{ key: "system", value: "iOS 19" },
			{ key: "device", value: "iPhone15,4" },
			{ key: "language", value: "es-AR" },
			{ key: "server", value: "0.5.0" },
			{ key: "errors", value: "5" },
		]);
	});
});

describe("sendFeedback", () => {
	const body = buildFeedback({
		message: "hi",
		category: "other",
		diagnostics: null,
	});
	const shot = { size: 3 } as unknown as File;

	it("sends the note, then the screenshot to the id it got", async () => {
		const submit = jest.fn(async () => ({ ok: true, id: "fb1" }));
		const attachScreenshot = jest.fn(async (_input: { id: string }) => ({
			ok: true,
		}));
		expect(
			await sendFeedback(
				{ feedback: { submit, attachScreenshot } } as never,
				body,
				shot,
			),
		).toEqual({ status: "sent" });
		expect(attachScreenshot.mock.calls[0]?.[0]).toMatchObject({ id: "fb1" });
	});

	it("keeps the note when only the picture fails", async () => {
		const result = await sendFeedback(
			{
				feedback: {
					submit: async () => ({ ok: true, id: "fb1" }),
					attachScreenshot: async () => {
						throw new Error("413");
					},
				},
			} as never,
			body,
			shot,
		);
		expect(result).toEqual({ status: "sentWithoutScreenshot" });
	});

	it("tells the hourly limit from other failures", async () => {
		const failing = (status: number) =>
			({
				feedback: {
					submit: async () => {
						throw Object.assign(new Error("x"), { status });
					},
				},
			}) as never;
		expect(await sendFeedback(failing(409), body, null)).toEqual({
			status: "limit",
		});
		expect(await sendFeedback(failing(500), body, null)).toEqual({
			status: "failed",
		});
	});
});
