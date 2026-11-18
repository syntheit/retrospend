/**
 * The idempotency and event steps of the v1 chain on a publicWrite route that
 * somehow reaches them with a user (authenticate never lets that happen; these
 * checks hold on their own, so removing the explicit skip in either step
 * fails here and not only behind authenticate).
 */
import { createRouterClient, implement } from "@orpc/server";
import { v1 as route } from "@retrospend/api-contract/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

const spies = vi.hoisted(() => ({ start: vi.fn(), append: vi.fn() }));
vi.mock("~/server/services/api-v1/idempotency.service", () => ({
	startIdempotentRequest: spies.start,
	completeIdempotentRequest: vi.fn(),
	releaseIdempotentRequest: vi.fn(),
	hashRequest: async () => "hash",
}));
vi.mock("~/server/services/events/scope", () => ({
	appendRouteEvent: spies.append,
	withEventIntent: async (_intent: unknown, fn: () => Promise<unknown>) =>
		await fn(),
}));

import { recordsEvent } from "../events/middleware";
import { idempotency } from "../idempotency";
import type { V1Context } from "../middleware";

const out = z.object({ ok: z.boolean() });
const contract = {
	// The meta a conforming route has: public, a publicWrite, no event.
	publicWrite: route
		.route({ method: "POST", path: "/pw", operationId: "pw" })
		.meta({ scope: "public", publicWrite: "resetToken" })
		.output(out),
	// A signed-in write, as the control: it needs a key.
	signedWrite: route
		.route({ method: "POST", path: "/sw", operationId: "sw" })
		.meta({ scope: "write:expenses", event: "thing.created" })
		.output(out),
	// The same event on a route without publicWrite, as the control.
	eventWrite: route
		.route({ method: "POST", path: "/ew", operationId: "ew" })
		.meta({ scope: "write:expenses", event: "thing.created" })
		.output(out),
	// A publicWrite that names an event, which the conventions refuse; the event
	// step must still append nothing for it.
	publicWriteWithEvent: route
		.route({ method: "POST", path: "/pwe", operationId: "pwe" })
		.meta({
			scope: "public",
			publicWrite: "resetRequest",
			event: "thing.created",
		})
		.output(out),
};

const t = implement(contract).$context<V1Context>();
const handler = async () => ({ ok: true });
const router = t.router({
	publicWrite: t.publicWrite.use(idempotency).handler(handler),
	signedWrite: t.signedWrite.use(idempotency).handler(handler),
	eventWrite: t.eventWrite.use(recordsEvent).handler(handler),
	publicWriteWithEvent: t.publicWriteWithEvent
		.use(recordsEvent)
		.handler(handler),
});

// A caller the chain could have attached: only its shape matters to these steps.
const user = {
	principal: { userId: "someone-else", kind: "web" },
	db: {},
	timeZone: "UTC",
} as unknown as NonNullable<V1Context["user"]>;
const client = createRouterClient(router, {
	context: { headers: new Headers(), user } satisfies V1Context,
});

beforeEach(() => {
	spies.start.mockReset();
	spies.append.mockReset();
});

describe("idempotency on a publicWrite route", () => {
	it("takes no Idempotency-Key and stores nothing, while a signed-in write still needs one", async () => {
		await expect(client.publicWrite()).resolves.toEqual({ ok: true });
		expect(spies.start).not.toHaveBeenCalled();

		await expect(client.signedWrite()).rejects.toMatchObject({
			code: "idempotency_key_required",
		});
		expect(spies.start).not.toHaveBeenCalled();
	});
});

describe("events on a publicWrite route", () => {
	it("appends no event, even for a route that names one", async () => {
		await client.eventWrite();
		expect(spies.append).toHaveBeenCalledTimes(1);
		spies.append.mockClear();

		await expect(client.publicWriteWithEvent()).resolves.toEqual({ ok: true });
		expect(spies.append).not.toHaveBeenCalled();
	});
});
