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

	it("fails writes scoped public or read, and unregistered events", () => {
		const bad = {
			a: v1
				.route({ method: "POST", path: "/a", operationId: "a" })
				.meta({ scope: "public" })
				.output(out),
			b: v1
				.route({ method: "POST", path: "/b", operationId: "b" })
				.meta({ scope: "write:expenses", event: "b.created" })
				.output(out),
			c: v1
				.route({ method: "DELETE", path: "/c", operationId: "c" })
				.meta({ scope: "read", event: "b.created" })
				.output(out),
		};
		expect(checkContractConventions(bad, ["b.created"])).toEqual([
			"a: a write needs a write scope, not public",
			"a: write without an event",
			"c: a write needs a write scope, not read",
		]);
		expect(checkContractConventions({ b: bad.b }, [])).toEqual([
			'b: event "b.created" is not registered',
		]);
	});

	it("needs a preview twin with the same input on a money write", () => {
		const write = v1
			.route({ method: "POST", path: "/payments", operationId: "pay" })
			.meta({ scope: "write:money", event: "payment.recorded" })
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

		const otherInput = v1
			.route({
				method: "POST",
				path: "/payments/preview",
				operationId: "previewPay",
			})
			.meta({ scope: "write:money", previewOf: "/payments" })
			.input(out)
			.output(previewResultSchema);
		expect(
			checkContractConventions({ write, twin: otherInput }, events),
		).toEqual(["write: preview twin takes a different input"]);
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
