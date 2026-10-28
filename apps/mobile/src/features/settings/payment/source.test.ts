import { type PaymentMethod, preferred, withEdit, without } from "./source";

function method(id: string, over: Partial<PaymentMethod> = {}): PaymentMethod {
	return {
		id,
		type: "bank",
		label: id,
		identifier: `acct-${id}`,
		rank: 1,
		visibility: "PUBLIC",
		minAmount: null,
		currency: null,
		network: null,
		updatedAt: "2026-10-01T00:00:00.000Z",
		...over,
	};
}

describe("payment method lists", () => {
	const list = [method("a"), method("b"), method("c")];

	it("sends the whole list back with one method edited", () => {
		const out = withEdit(list, "b", {
			label: " Main ",
			identifier: "",
			visibility: "FRIENDS_ONLY",
		});
		expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
		expect(out[1]).toMatchObject({
			id: "b",
			label: "Main",
			identifier: null,
			visibility: "FRIENDS_ONLY",
			type: "bank",
		});
		expect(out[0]).toMatchObject({ label: "a", identifier: "acct-a" });
	});

	it("leaves a method out to delete it", () => {
		expect(without(list, "b").map((m) => m.id)).toEqual(["a", "c"]);
	});

	it("moves the preferred method to the front, order kept otherwise", () => {
		expect(preferred(list, "c").map((m) => m.id)).toEqual(["c", "a", "b"]);
		expect(preferred(list, "zzz").map((m) => m.id)).toEqual(["a", "b", "c"]);
	});
});
