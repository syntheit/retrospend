/**
 * G5 writes append their events through the outbox: one import finalize and
 * one export request each write exactly one event, a replayed request writes
 * no second one, and no payload carries a file name or a title (owner rule 4).
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
} from "../core/__tests__/harness";

await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	process.env.EXPORT_DIR = mkdtempSync(join(tmpdir(), "g5a-events-"));
});

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const DAY = new Date().toISOString().slice(0, 10);
const FILE_NAME = "secret-bank-statement.csv";
const TITLE = "Coffee beans q7";

describe("G5 write events", () => {
	let userId: string;
	let as: Record<string, string>;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = await asMobile(userId);
	});

	const eventsOf = (type: string) =>
		adminDb.apiEvent.findMany({
			where: { userId, type },
			select: { type: true, entityType: true, entityId: true, payload: true },
		});

	it("writes one import.finalized event without the file name or titles", async () => {
		const form = new FormData();
		form.set(
			"file",
			new File(
				[`title,amount,currency,date\n${TITLE},12.50,USD,${DAY}`],
				FILE_NAME,
				{ type: "text/csv" },
			),
		);
		form.set("source", "csv");
		const job = await expectBody<{ id: string; state: string }>(
			await call("/imports/jobs", {
				method: "POST",
				headers: as,
				form,
				idempotent: true,
			}),
			contract.imports.upload,
			201,
		);
		expect(await eventsOf("import.uploaded")).toHaveLength(1);
		for (let n = 0; n < 50; n++) {
			const j = await expectBody<{ state: string }>(
				await call(`/imports/jobs/${job.id}`, { headers: as }),
				contract.imports.getJob,
			);
			if (j.state === "ready") break;
			await new Promise((r) => setTimeout(r, 100));
		}

		const body = {
			rows: [{ index: 0, keep: true, categoryId: null, kind: "expense" }],
		};
		const key = "events-finalize-1";
		const send = () =>
			call(`/imports/jobs/${job.id}/finalize`, {
				method: "POST",
				headers: as,
				body,
				idempotent: key,
			});
		expect((await send()).status).toBe(200);
		expect((await send()).headers.get("idempotent-replayed")).toBe("true");

		const events = await eventsOf("import.finalized");
		expect(events).toHaveLength(1);
		const text = JSON.stringify(events[0]);
		expect(text).not.toContain(FILE_NAME);
		expect(text).not.toContain(TITLE);
		expect(events[0]?.payload).toMatchObject({ ids: { jobId: job.id } });

		// A preview appends nothing.
		await call(`/imports/jobs/${job.id}/undo/preview`, {
			method: "POST",
			headers: as,
			body: {},
		});
		expect(await eventsOf("import.undone")).toHaveLength(0);
	});

	it("writes one export.requested event with the job id and no file name", async () => {
		const key = "events-export-1";
		const send = () =>
			call("/exports/jobs", {
				method: "POST",
				headers: as,
				body: { kind: "data" },
				idempotent: key,
			});
		const first = await send();
		expect(first.status).toBe(202);
		const job = (await first.json()) as { id: string };
		expect((await send()).headers.get("idempotent-replayed")).toBe("true");

		const events = await eventsOf("export.requested");
		expect(events).toHaveLength(1);
		expect(events[0]?.entityId).toBe(job.id);
		const text = JSON.stringify(events[0]);
		expect(text).not.toMatch(/user-data|\.zip/);
	});
});
