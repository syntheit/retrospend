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

	it("lets a readsOnly POST be public with no event, and nothing else", () => {
		const reads = v1
			.route({ method: "POST", path: "/q", operationId: "q" })
			.meta({ scope: "public", readsOnly: true })
			.output(out);
		expect(checkContractConventions({ reads })).toEqual([]);

		const withEvent = v1
			.route({ method: "POST", path: "/r", operationId: "r" })
			.meta({ scope: "public", readsOnly: true, event: "b.created" })
			.output(out);
		const onGet = v1
			.route({ method: "GET", path: "/s", operationId: "s" })
			.meta({ scope: "public", readsOnly: true })
			.output(out);
		expect(
			checkContractConventions({ withEvent, onGet }, ["b.created"]),
		).toEqual([
			"onGet: readsOnly is for a POST",
			"withEvent: a readsOnly route cannot have an event",
		]);
	});

	it("lets a public POST write with publicWrite, with no event, and refuses a public write without it", () => {
		const token = v1
			.route({ method: "POST", path: "/t", operationId: "t" })
			.meta({ scope: "public", publicWrite: "resetToken" })
			.output(out);
		const request = v1
			.route({ method: "POST", path: "/u", operationId: "u" })
			.meta({ scope: "public", publicWrite: "resetRequest" })
			.output(out);
		expect(checkContractConventions({ token, request })).toEqual([]);

		// The same public write without the meta is still refused, as before.
		const bare = v1
			.route({ method: "POST", path: "/v", operationId: "v" })
			.meta({ scope: "public" })
			.output(out);
		expect(checkContractConventions({ bare })).toEqual([
			"bare: a write needs a write scope, not public",
			"bare: write without an event",
		]);
	});

	it("refuses publicWrite anywhere but a public POST with no event, and an unknown value", () => {
		const route = (path: `/${string}`, method: "GET" | "POST" | "DELETE") =>
			v1.route({ method, path, operationId: path.slice(1) }).output(out);
		const bad = {
			onGet: route("/g", "GET").meta({
				scope: "public",
				publicWrite: "resetToken",
			}),
			onDelete: route("/d", "DELETE").meta({
				scope: "public",
				publicWrite: "resetToken",
			}),
			signedIn: route("/s", "POST").meta({
				scope: "write:expenses",
				publicWrite: "resetToken",
				event: "b.created",
			}),
			withEvent: route("/e", "POST").meta({
				scope: "public",
				publicWrite: "resetToken",
				event: "b.created",
			}),
			reads: route("/r", "POST").meta({
				scope: "public",
				publicWrite: "resetToken",
				readsOnly: true,
			}),
			twin: route("/w/preview", "POST").meta({
				scope: "public",
				publicWrite: "resetToken",
				previewOf: "/w",
			}),
			unknown: route("/x", "POST").meta({
				scope: "public",
				// A value off the list, as a typo or a new member would be.
				publicWrite: "resetTokn" as never,
			}),
		};
		const problems = checkContractConventions(bad, ["b.created"]);
		for (const expected of [
			"onGet: publicWrite is for a POST",
			"onDelete: publicWrite is for a POST",
			"signedIn: publicWrite is for a public route",
			"withEvent: a publicWrite route cannot have an event",
			"reads: a publicWrite route cannot be readsOnly",
			"twin: a publicWrite route cannot be a preview twin",
			'unknown: unknown publicWrite "resetTokn"',
		])
			expect(problems).toContain(expected);
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
