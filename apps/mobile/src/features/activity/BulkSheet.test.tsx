import type { RetrospendClient } from "@retrospend/api-client";
import { flush, mount, words, world } from "../../../test/harness";
import { BulkSheet } from "./BulkSheet";

// The sheet under the dev flag: a picked expense with an unsynced write says
// Sync first, and an outbox that cannot be read shows the failed state; the
// preview is not asked for either way.

const mockBulk = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceBulkWrites: () => mockBulk(),
}));

const diff = { changes: [], unchanged: [], unavailable: [] };
const previewBulkDelete = jest.fn(async () => diff);

const writes = (unsettled: string[] = []) => ({
	bookBulk: async () => null,
	comparePreviewBulk: async () => undefined,
	settleBulk: () => undefined,
	undoneBulk: () => undefined,
	bulkUnsettled: () => new Set(unsettled),
});

async function open(ids = ["a", "b"]) {
	return mount(
		<BulkSheet
			action={{ kind: "delete" }}
			ids={ids}
			onClose={() => {}}
			onDone={() => {}}
		/>,
	);
}

beforeEach(() => {
	previewBulkDelete.mockClear();
	world.api = {
		expenses: { previewBulkDelete },
	} as unknown as RetrospendClient;
});

describe("BulkSheet under the device flag", () => {
	it("says Sync first for an id from a bulk action no pull has settled, and asks for no preview", async () => {
		mockBulk.mockReturnValue(writes(["b"]));
		const tree = await open();
		await flush();
		expect(words(tree)).toContain("Sync first");
		expect(previewBulkDelete).not.toHaveBeenCalled();
	});

	it("shows the failed state when the outbox cannot be read, and asks for no preview", async () => {
		mockBulk.mockReturnValue(writes());
		world.local.outbox.snapshot = async () => {
			throw new Error("disk");
		};
		const tree = await open();
		await flush();
		expect(words(tree)).toContain("Couldn't change those expenses");
		expect(previewBulkDelete).not.toHaveBeenCalled();
	});

	it("previews as ever when nothing waits", async () => {
		mockBulk.mockReturnValue(writes());
		await open();
		await flush();
		expect(previewBulkDelete).toHaveBeenCalledTimes(1);
	});

	it("with the flag off asks for the preview at once and never reads the outbox", async () => {
		mockBulk.mockReturnValue(null);
		const snapshot = jest.spyOn(world.local.outbox, "snapshot");
		await open();
		await flush();
		expect(previewBulkDelete).toHaveBeenCalledTimes(1);
		expect(snapshot).not.toHaveBeenCalled();
	});
});
