import type { RetrospendClient } from "@retrospend/api-client";
import {
	act,
	disabled,
	flush,
	lastToast,
	mount,
	press,
	pressAsync,
	type Tree,
	wait,
	words,
	world,
} from "../../../test/harness";
import { WriteSheet } from "./WriteForm";

// The generic write sheet, free of any budget type: Save (or the danger verb)
// stays off until the server's dry run of the exact body is in and says there
// is something to save; the write carries that body under one idempotency
// key, and the toast undoes it with the server's token for the family.
jest.mock("@/ui/Sheet", () => require("../../../test/native").sheetMock);
jest.mock("@/ui/Button", () => require("../../../test/native").buttonMock);

interface Call {
	route: string;
	input?: unknown;
	key?: string;
}

function fakeApi(options: { failWrites?: number; changes?: boolean } = {}) {
	const calls: Call[] = [];
	let failures = options.failWrites ?? 0;
	const api = {
		accounts: {
			previewClose: async (input: unknown) => {
				calls.push({ route: "preview", input });
				return options.changes === false
					? { changes: [], unchanged: [], unavailable: [] }
					: {
							changes: [
								{
									id: "netWorth",
									before: { minor: 100, currency: "USD" },
									after: { minor: 0, currency: "USD" },
								},
							],
							unchanged: [],
							unavailable: [],
						};
			},
			close: async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "write",
					input,
					key: init?.context?.idempotencyKey,
				});
				if (failures > 0) {
					failures -= 1;
					throw new Error("down");
				}
				return { undo: "token-1" };
			},
			undo: async (input: unknown) => {
				calls.push({ route: "undo", input });
				return {};
			},
		},
	};
	world.api = api as unknown as RetrospendClient;
	return calls;
}

function Sheet({
	onClose,
	onDone,
	destructive,
	canSave,
	done,
}: {
	onClose: () => void;
	onDone: () => void;
	destructive?: boolean;
	canSave?: () => boolean;
	done?: () => void;
}) {
	const shared = {
		title: "Close Cash",
		visible: true,
		input: { id: "acc-1" },
		family: "accounts" as const,
		canSave,
		done,
		message: () => "Closed Cash",
		onClose,
		onDone,
		preview: (api: RetrospendClient, body: { id: string }) =>
			api.accounts.previewClose(body),
		write: (api: RetrospendClient, body: { id: string }, key: string) =>
			api.accounts.close(body, { context: { idempotencyKey: key } }),
		changes: ({ status }: { status: string }) => <>{`dry run ${status}`}</>,
	};
	return destructive ? (
		<WriteSheet
			{...shared}
			destructive={{ label: "Close it", busyLabel: "Closing" }}
		/>
	) : (
		<WriteSheet {...shared} submitLabel="Close account" />
	);
}

async function open(props: Parameters<typeof Sheet>[0]): Promise<Tree> {
	const tree = await mount(<Sheet {...props} />);
	await wait(300);
	return tree;
}

describe("the generic write sheet", () => {
	it("keeps Save off until the dry run is in, then writes that body under one key", async () => {
		const calls = fakeApi();
		const onClose = jest.fn();
		const onDone = jest.fn();
		const tree = await mount(<Sheet onClose={onClose} onDone={onDone} />);
		expect(disabled(tree, "Close account")).toBe(true);
		await wait(300);
		expect(disabled(tree, "Close account")).toBe(false);
		expect(words(tree)).toContain("dry run ready");

		await pressAsync(tree, "Close account");
		const preview = calls.find((c) => c.route === "preview");
		const write = calls.find((c) => c.route === "write");
		expect(write?.input).toEqual(preview?.input);
		expect(write?.key).toBeTruthy();
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(lastToast().message).toBe("Closed Cash");
	});

	it("replays the same key after a failed write and shows the error", async () => {
		const calls = fakeApi({ failWrites: 1 });
		const onClose = jest.fn();
		const tree = await open({ onClose, onDone: jest.fn() });
		await pressAsync(tree, "Close account");
		expect(words(tree)).toContain("Couldn't save. Try again.");
		expect(onClose).not.toHaveBeenCalled();
		await pressAsync(tree, "Close account");
		const writes = calls.filter((c) => c.route === "write");
		expect(writes).toHaveLength(2);
		expect(writes[1]?.key).toBe(writes[0]?.key);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("undoes with the family's token on a fresh key and refreshes the screen", async () => {
		const calls = fakeApi();
		const onDone = jest.fn();
		const tree = await open({ onClose: jest.fn(), onDone });
		await pressAsync(tree, "Close account");
		onDone.mockClear();
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "token-1",
		});
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(lastToast().message).toBe("Undone");
	});

	it("keeps Save off while the dry run says there is nothing to save", async () => {
		fakeApi({ changes: false });
		const tree = await open({
			onClose: jest.fn(),
			onDone: jest.fn(),
			canSave: () => false,
		});
		expect(disabled(tree, "Close account")).toBe(true);
	});

	it("lets the caller end the write its own way, with no server-token toast", async () => {
		fakeApi();
		const done = jest.fn();
		const onClose = jest.fn();
		const tree = await open({ onClose, onDone: jest.fn(), done });
		await pressAsync(tree, "Close account");
		expect(done).toHaveBeenCalledTimes(1);
		expect(world.toast.show).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("puts Cancel and the danger verb in the footer for a destructive write", async () => {
		const calls = fakeApi();
		const onClose = jest.fn();
		const tree = await open({
			onClose,
			onDone: jest.fn(),
			destructive: true,
		});
		expect(disabled(tree, "Close it")).toBe(false);
		press(tree, "Cancel");
		expect(onClose).toHaveBeenCalledTimes(1);
		await pressAsync(tree, "Close it");
		expect(calls.filter((c) => c.route === "write")).toHaveLength(1);
		expect(lastToast().undo?.label).toBe("Undo");
		await flush();
	});
});
