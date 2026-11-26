import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { exclusive } from "./queue";

// The queue's one lock is the account's, not the object's: the app and the
// background task each make an Outbox over the same entries.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("exclusive", () => {
	it("serializes two outboxes of one account", async () => {
		const first = createOutbox(createMemoryStore(), "s1");
		const second = createOutbox(createMemoryStore(), "s1");
		const order: string[] = [];
		let open: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const a = exclusive(first, async () => {
			order.push("a start");
			await gate;
			order.push("a end");
		});
		const b = exclusive(second, async () => {
			order.push("b");
		});
		await tick();
		expect(order).toEqual(["a start"]);
		open();
		await Promise.all([a, b]);
		expect(order).toEqual(["a start", "a end", "b"]);
	});

	it("does not hold another account behind it", async () => {
		const mine = createOutbox(createMemoryStore(), "s2");
		const other = createOutbox(createMemoryStore(), "s3");
		let open: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const a = exclusive(mine, () => gate);
		let ran = false;
		await exclusive(other, async () => {
			ran = true;
		});
		expect(ran).toBe(true);
		open();
		await a;
	});
});
