import type { RetrospendClient } from "@retrospend/api-client";
import { previewDelete, runDelete } from "./deleteEntry";

// Deleting a split: the server's warning is carried to the sheet, nothing
// confirms for the person, and a delete the server cannot take back has no
// Undo to offer.

const diff = { changes: [], unchanged: [], unavailable: [] };

function api(over: Record<string, unknown>) {
	return {
		expenses: {},
		"shared-expenses": over,
	} as unknown as RetrospendClient;
}

describe("deleting a split expense", () => {
	it("carries the server's warning and previews the confirmed delete", async () => {
		const previews: unknown[] = [];
		const client = api({
			previewDelete: async (input: { confirmUnsettled?: boolean }) => {
				previews.push(input);
				if (!input.confirmUnsettled) {
					throw Object.assign(new Error("Deleting it removes that debt."), {
						status: 409,
					});
				}
				return diff;
			},
		});
		const out = await previewDelete(client, { id: "s1", shared: true });
		expect(out.warning).toBe("Deleting it removes that debt.");
		expect(out.state.status).toBe("ready");
		expect(previews).toEqual([
			{ id: "s1" },
			{ id: "s1", confirmUnsettled: true },
		]);
	});

	it("has no warning when nothing is owed", async () => {
		const client = api({ previewDelete: async () => diff });
		const out = await previewDelete(client, { id: "s1", shared: true });
		expect(out).toEqual({
			state: { status: "ready", diff },
			warning: null,
			undoable: true,
		});
	});

	it("knows before the tap that the server will give no Undo", async () => {
		const noUndo = {
			...diff,
			detail: { kind: "sharedExpense.delete", undoable: false },
		};
		const client = api({ previewDelete: async () => noUndo });
		const out = await previewDelete(client, { id: "s1", shared: true });
		expect(out.undoable).toBe(false);
	});

	it("sends confirmUnsettled only when the warning was shown", async () => {
		const sent: unknown[] = [];
		const client = api({
			delete: async (input: unknown) => {
				sent.push(input);
				return { id: "s1", undo: "tok" };
			},
		});
		const target = { id: "s1", shared: true };
		await runDelete(client, target, "k1");
		const out = await runDelete(client, target, "k2", true);
		expect(sent).toEqual([{ id: "s1" }, { id: "s1", confirmUnsettled: true }]);
		expect(out).toEqual({
			status: "deleted",
			undo: { entity: "shared-expenses", token: "tok" },
		});
	});

	it("deletes without an Undo when the server gave no token", async () => {
		const client = api({ delete: async () => ({ id: "s1", undo: null }) });
		const out = await runDelete(client, { id: "s1", shared: true }, "k");
		expect(out).toEqual({ status: "deleted", undo: null });
	});

	it("reads a refusal and a missing answer apart", async () => {
		const refused = api({
			delete: async () => {
				throw Object.assign(new Error("no"), { status: 403 });
			},
		});
		expect(await runDelete(refused, { id: "s1", shared: true }, "k")).toEqual({
			status: "refused",
		});
		const offline = api({
			delete: async () => {
				throw new Error("network");
			},
		});
		expect(await runDelete(offline, { id: "s1", shared: true }, "k")).toEqual({
			status: "offline",
		});
	});
});
