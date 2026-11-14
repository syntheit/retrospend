/**
 * GET /api/v1/sync/settings on Postgres (E2EE P16), through the handler the
 * Next route uses: the settings the figures read, in the shape of a device's
 * settings row. The zone is the one the figures resolve (never null), hidden
 * projects follow Hide from reports, and only a mobile app session may call it.
 */
import { contract, SCOPES } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Body = {
	homeCurrency: string;
	timeZone: string;
	startDay: number;
	hiddenProjectIds: string[];
	defaultRateTypes: Record<string, string>;
};

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.94" };

const pull = async (headers: Record<string, string>) =>
	expectBody<Body>(
		await call("/sync/settings", { headers: { ...OWN_IP, ...headers } }),
		contract.sync.settings,
	);

describe("settings sync route: who may call it", () => {
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it("answers a mobile app session", async () => {
		const res = await call("/sync/settings", {
			headers: { ...OWN_IP, ...(await asMobile(userId)) },
		});
		expect(res.status, await res.text()).toBe(200);
	});

	it("needs credentials and refuses a key with every token scope", async () => {
		await expectProblem(
			await call("/sync/settings", { headers: OWN_IP }),
			401,
			"unauthenticated",
		);
		const res = await call("/sync/settings", {
			headers: { ...OWN_IP, ...(await asKey(userId, [...SCOPES])) },
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			code: "missing_scope",
			requiredScope: "sync",
		});
	});

	it("refuses the web app's cookie session", async () => {
		await expectProblem(
			await call("/sync/settings", {
				headers: { ...OWN_IP, ...(await webCookieFor(userId)) },
			}),
			403,
			"missing_scope",
		);
	});
});

describe("settings sync route: the reading", () => {
	const previousZone = process.env.DEFAULT_TIME_ZONE;

	beforeAll(() => {
		process.env.DEFAULT_TIME_ZONE = "Pacific/Auckland";
	});

	afterAll(() => {
		if (previousZone === undefined) delete process.env.DEFAULT_TIME_ZONE;
		else process.env.DEFAULT_TIME_ZONE = previousZone;
	});

	const userWith = async (data: Record<string, unknown>) => {
		const id = (await createTestUser()).user.id;
		await adminDb.user.update({ where: { id }, data });
		return { id, as: await asMobile(id) };
	};

	it("carries the home currency, start day and preferred rate types", async () => {
		const { as } = await userWith({
			homeCurrency: "ARS",
			fiscalMonthStartDay: 15,
			timeZone: "Asia/Tokyo",
			defaultRateTypes: { ARS: "blue" },
		});
		expect(await pull(as)).toEqual({
			homeCurrency: "ARS",
			timeZone: "Asia/Tokyo",
			startDay: 15,
			hiddenProjectIds: [],
			defaultRateTypes: { ARS: "blue" },
		});
	});

	it("sends the default zone for a user with none stored, or one the server does not support", async () => {
		const none = await userWith({ timeZone: null });
		const bogus = await userWith({ timeZone: "Mars/Olympus" });
		expect((await pull(none.as)).timeZone).toBe("Pacific/Auckland");
		expect((await pull(bogus.as)).timeZone).toBe("Pacific/Auckland");
	});

	it("sends an alias zone in the canonical spelling the figures use", async () => {
		const alias = "America/Argentina/Buenos_Aires";
		const { as } = await userWith({ timeZone: alias });
		const canonical = new Intl.DateTimeFormat("en-US", {
			timeZone: alias,
		}).resolvedOptions().timeZone;
		expect((await pull(as)).timeZone).toBe(canonical);
	});

	it("sends empty default rate types as an empty object", async () => {
		const { as } = await userWith({ defaultRateTypes: {} });
		expect((await pull(as)).defaultRateTypes).toEqual({});
	});

	it("lists the projects the caller hides from reports, and no one else's", async () => {
		const { id, as } = await userWith({});
		const bob = (await createTestUser()).user.id;
		const project = async (hide: boolean, who: string) => {
			const p = await adminDb.project.create({
				data: { name: "P", createdById: bob, primaryCurrency: "USD" },
			});
			await adminDb.projectParticipant.create({
				data: {
					projectId: p.id,
					participantType: "user",
					participantId: who,
					excludeFromAnalytics: hide,
				},
			});
			return p.id;
		};
		const hidden = await project(true, id);
		const shown = await project(false, id);
		await project(true, bob);
		expect((await pull(as)).hiddenProjectIds).toEqual([hidden]);
		// Showing it again takes it off the list.
		await adminDb.projectParticipant.updateMany({
			where: { projectId: hidden, participantId: id },
			data: { excludeFromAnalytics: false },
		});
		expect((await pull(as)).hiddenProjectIds).toEqual([]);
		expect(shown).not.toBe(hidden);
	});
});
