import { type ActionDef, menuOf } from "./actionRegistry";

type Id = "a" | "b" | "c";
const defs: Record<Id, ActionDef<Id>> = {
	a: { id: "a", icon: "Pencil" },
	b: { id: "b", destructive: true, icon: "Trash2" },
	c: { id: "c" },
};
const words: Record<Id, string> = { a: "A", b: "B", c: "C" };

describe("menuOf", () => {
	it("keeps the registry's order and carries icon and destructive", () => {
		const run = { a: jest.fn(), b: jest.fn(), c: jest.fn() };
		const items = menuOf(["a", "c"], defs, words, run);
		expect(items.map((i) => i.id)).toEqual(["a", "c"]);
		expect(items[0]).toMatchObject({ label: "A", icon: "Pencil" });
		items[1]?.onPress();
		expect(run.c).toHaveBeenCalled();
	});

	it("puts destructive items last", () => {
		const run = { a: jest.fn(), b: jest.fn(), c: jest.fn() };
		const items = menuOf(["b", "a", "c"], defs, words, run);
		expect(items.map((i) => i.id)).toEqual(["a", "c", "b"]);
		expect(items[2]?.destructive).toBe(true);
	});
});
