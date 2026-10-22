import { describe, expect, it } from "vitest";
import type { Method } from "~/components/settings/payment-methods-card";
import {
	makePrimary,
	moveMethod,
	sameMethods,
	toUpsertInput,
	withVisibility,
} from "../payment/method-list";

const m = (id: string, extra: Partial<Method> = {}): Method => ({
	id,
	localId: `l_${id}`,
	type: "wise",
	label: "",
	identifier: `${id}@example.com`,
	visibility: "PAYMENT_ONLY",
	minAmount: "",
	currency: "",
	network: "",
	...extra,
});

describe("payment method list", () => {
	const list = [m("a"), m("b"), m("c")];
	const ids = (l: Method[]) => l.map((x) => x.id);

	it("moves a method up and down, and not past the ends", () => {
		expect(ids(moveMethod(list, 1, -1))).toEqual(["b", "a", "c"]);
		expect(ids(moveMethod(list, 1, 1))).toEqual(["a", "c", "b"]);
		expect(ids(moveMethod(list, 0, -1))).toEqual(["a", "b", "c"]);
		expect(ids(moveMethod(list, 2, 1))).toEqual(["a", "b", "c"]);
	});

	it("makes a method primary by moving it first", () => {
		expect(ids(makePrimary(list, 2))).toEqual(["c", "a", "b"]);
		expect(ids(makePrimary(list, 0))).toEqual(["a", "b", "c"]);
	});

	it("changes one method's visibility", () => {
		const next = withVisibility(list, "l_b", "PUBLIC");
		expect(next.map((x) => x.visibility)).toEqual([
			"PAYMENT_ONLY",
			"PUBLIC",
			"PAYMENT_ONLY",
		]);
	});

	it("ranks by order and drops empty optional fields, like today's card", () => {
		const input = toUpsertInput([
			m("a", { minAmount: "10.5", label: "Main" }),
			m("b"),
		]);
		expect(input[0]).toMatchObject({
			id: "a",
			rank: 1,
			minAmount: 10.5,
			label: "Main",
		});
		expect(input[1]).toMatchObject({ id: "b", rank: 2 });
		expect(input[1]?.label).toBeUndefined();
		expect(input[1]?.currency).toBeUndefined();
	});

	it("compares lists by what would be written", () => {
		expect(sameMethods(list, [...list])).toBe(true);
		expect(sameMethods(list, moveMethod(list, 0, 1))).toBe(false);
	});
});
