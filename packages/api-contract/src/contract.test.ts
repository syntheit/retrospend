import { describe, expect, it } from "vitest";
import * as z from "zod";
import { checkContractConventions } from "./common/conventions";
import { v1 } from "./common/meta";
import { previewResultSchema } from "./common/preview";
import { contract } from "./index";

describe("v1 contract conventions", () => {
	it("holds for the real contract", () => {
		expect(checkContractConventions(contract)).toEqual([]);
	});

	const out = z.object({ ok: z.boolean() });
	const input = z.object({ amount: z.int() });

	it("fails a route without a scope", () => {
		const bad = {
			thing: v1
				.route({ method: "GET", path: "/thing", operationId: "getThing" })
				.output(out),
		};
		expect(checkContractConventions(bad)).toEqual(["thing: no scope"]);
	});

	it("fails a public write and a write without a registered event", () => {
		const bad = {
			a: v1
				.route({ method: "POST", path: "/a", operationId: "a" })
				.meta({ scope: "public" })
				.output(out),
			b: v1
				.route({ method: "POST", path: "/b", operationId: "b" })
				.meta({ scope: "write:expenses", event: "b.created" })
				.output(out),
		};
		expect(checkContractConventions(bad, [])).toEqual([
			"a: only GET routes may be public",
			"a: write without an event",
			'b: event "b.created" is not registered',
		]);
	});

	it("needs a preview twin with the same input on a money write", () => {
		const write = v1
			.route({ method: "POST", path: "/payments", operationId: "pay" })
			.meta({ scope: "write:money", event: "payment.recorded", money: true })
			.input(input)
			.output(out);
		const events = ["payment.recorded"];

		expect(checkContractConventions({ write }, events)).toEqual([
			"write: money write without a preview twin",
		]);

		const twin = v1
			.route({
				method: "POST",
				path: "/payments/preview",
				operationId: "previewPay",
			})
			.meta({ scope: "write:money", previewOf: "/payments" })
			.input(input)
			.output(previewResultSchema);
		expect(checkContractConventions({ write, twin }, events)).toEqual([]);
	});

	it("fails duplicate routes and operation ids", () => {
		const route = v1
			.route({ method: "GET", path: "/x", operationId: "getX" })
			.meta({ scope: "read" })
			.output(out);
		expect(checkContractConventions({ one: route, two: route })).toEqual([
			"two: GET /x is also one",
			"two: duplicate operationId getX",
		]);
	});
});
