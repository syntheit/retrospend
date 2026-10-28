import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";

const renderer = require("react-test-renderer");
const { act } = renderer;

jest.mock("@/data/ids", () => {
	let n = 0;
	return { newClientId: () => `id-${++n}` };
});

type Write = (
	body: { draft: string },
	key: string,
) => Promise<{ undo: string }>;
interface Out {
	key: string | null;
	commit?: () => Promise<unknown>;
}

// A sheet that stays mounted: one body, one key from useWriteIds, one write.
function Probe({ write, out }: { write: Write; out: Out }) {
	const { idFor } = useWriteIds("draft-1");
	const key = idFor("apply");
	const flow = useMoneyWrite({
		input: { draft: "draft-1" },
		idempotencyKey: key,
		preview: async () => ({}),
		write,
		debounceMs: 0,
	});
	out.key = key;
	out.commit = flow.commit;
	return null;
}

async function mount(write: Write) {
	const out: Out = { key: null };
	let tree: { update(el: unknown): void } | undefined;
	await act(async () => {
		tree = renderer.create(<Probe out={out} write={write} />);
	});
	return {
		out,
		rerender: () =>
			act(async () => {
				tree?.update(<Probe out={out} write={write} />);
			}),
	};
}

describe("write ids on a sheet that stays mounted", () => {
	it("gives the next write a new key once the first was confirmed", async () => {
		const sent: string[] = [];
		const { out, rerender } = await mount(async (_b, key) => {
			sent.push(key);
			return { undo: "t" };
		});
		const first = out.key;
		await act(async () => {
			await out.commit?.();
		});
		// Undo, then the sheet opens again on the same draft.
		await rerender();
		expect(out.key).not.toBe(first);
		await act(async () => {
			await out.commit?.();
		});
		expect(sent).toHaveLength(2);
		expect(sent[1]).not.toBe(sent[0]);
	});

	it("keeps the key after a failed write so a retry still replays", async () => {
		const sent: string[] = [];
		let fail = true;
		const { out, rerender } = await mount(async (_b, key) => {
			sent.push(key);
			if (fail) throw new Error("offline");
			return { undo: "t" };
		});
		const first = out.key;
		await act(async () => {
			expect(await out.commit?.()).toBeNull();
		});
		await rerender();
		expect(out.key).toBe(first);
		fail = false;
		await act(async () => {
			await out.commit?.();
		});
		expect(sent).toEqual([first, first]);
	});
});
