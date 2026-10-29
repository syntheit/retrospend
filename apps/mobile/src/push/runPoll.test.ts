import type { LocalNotification } from "./feed";
import { type PollDeps, runPoll } from "./runPoll";

const note: LocalNotification = {
	key: "event:1",
	kind: "payment.recorded",
	entity: { type: "payment", id: "p1" },
};

function deps(over: Partial<PollDeps> = {}) {
	const post = jest.fn();
	const commit = jest.fn(async () => undefined);
	const poll = jest.fn(async () => ({ notifications: [note], commit }));
	const ensureChannels = jest.fn();
	const base: PollDeps = {
		enabled: async () => ({ baseUrl: "https://s", meId: "me" }),
		signedInAs: async () => "me",
		forget: jest.fn(async () => undefined),
		poll,
		local: { enabled: () => true, post, ensureChannels },
		translate: () => (key: string) => key,
		channels: () => [],
		post: (n) => ({
			key: n.key,
			channel: "payments",
			title: "t",
			body: "b",
			url: "retrospend://people",
		}),
		...over,
	};
	return { base, post, poll, commit, ensureChannels };
}

describe("background run", () => {
	it("posts what the poll found, on channels made first", async () => {
		const { base, post, ensureChannels } = deps();
		expect(await runPoll(base)).toBe(1);
		expect(ensureChannels).toHaveBeenCalled();
		expect(post).toHaveBeenCalledWith(
			expect.objectContaining({
				channel: "payments",
				url: "retrospend://people",
			}),
		);
	});

	it("does nothing while Push is off", async () => {
		const { base, poll } = deps({ enabled: async () => null });
		expect(await runPoll(base)).toBe(0);
		expect(poll).not.toHaveBeenCalled();
	});

	it("leaves the cursor alone while the system blocks notifications", async () => {
		const { base, poll } = deps();
		base.local = { ...base.local, enabled: () => false };
		expect(await runPoll(base)).toBe(0);
		expect(poll).not.toHaveBeenCalled();
	});

	it.each([
		["another account", "other"],
		["nobody", null],
	])("stops for good when %s holds the server's token", async (_who, id) => {
		const { base, poll, post } = deps({ signedInAs: async () => id });
		expect(await runPoll(base)).toBe(0);
		expect(poll).not.toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
		expect(base.forget).toHaveBeenCalledWith({
			baseUrl: "https://s",
			meId: "me",
		});
	});

	it("moves the cursor only after posting", async () => {
		const { base, post, commit } = deps();
		post.mockImplementation(() => {
			expect(commit).not.toHaveBeenCalled();
		});
		await runPoll(base);
		expect(commit).toHaveBeenCalledTimes(1);
	});

	it("keeps the cursor when posting fails", async () => {
		const { base, post, commit } = deps();
		post.mockImplementation(() => {
			throw new Error("blocked");
		});
		await expect(runPoll(base)).rejects.toThrow();
		expect(commit).not.toHaveBeenCalled();
	});
});
