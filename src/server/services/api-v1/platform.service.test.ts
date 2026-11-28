/**
 * GET /server-info features.autoPost: the instance's auto-post setting, taken
 * from autoPostEnabled() and nowhere else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
	NODE_ENV: "production",
	DATABASE_URL: "postgresql://u:p@localhost:5432/d",
	ADVANCED_PROTECTION_ENABLED: false,
	RECURRING_AUTO_POST: undefined as string | undefined,
}));
const flags = vi.hoisted(() => ({ categoryWrites: true }));
vi.mock("~/env", () => ({ env }));
vi.mock("~/server/services/category/category-writes", () => ({
	get CATEGORY_WRITES() {
		return flags.categoryWrites;
	},
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/services/preview", () => ({ forUser: vi.fn() }));
vi.mock("~/server/services/protection/now", () => ({
	isProtectedNow: vi.fn(),
}));
vi.mock("~/server/services/keys/data-key.service", () => ({
	ensureUserKeyringWhenSealing: vi.fn(),
}));
vi.mock("~/server/services/settings", () => ({
	isInviteOnlyEnabled: vi.fn(async () => false),
	isAllowAllUsersToGenerateInvitesEnabled: vi.fn(async () => false),
}));
vi.mock("~/server/storage", () => ({ getImageUrl: vi.fn() }));

const { getServerInfo } = await import("./platform.service");
const { autoPostEnabled } = await import("../recurring-auto-post");
const NO_PUSH = { allowHosts: new Set<string>() };

// Every value RECURRING_AUTO_POST accepts (src/env.js: "true", "false", unset),
// in every NODE_ENV, with the answer worked out from the setting's docs: the
// switch wins; unset means on in production only.
const CASES: [string | undefined, string, boolean][] = [
	["true", "production", true],
	["true", "development", true],
	["true", "test", true],
	["false", "production", false],
	["false", "development", false],
	["false", "test", false],
	[undefined, "production", true],
	[undefined, "development", false],
	[undefined, "test", false],
];

describe("server-info features.autoPost", () => {
	beforeEach(() => {
		env.RECURRING_AUTO_POST = undefined;
		env.NODE_ENV = "production";
	});

	it.each(CASES)(
		"RECURRING_AUTO_POST=%s in %s is %s and equals autoPostEnabled()",
		async (setting, nodeEnv, expected) => {
			env.RECURRING_AUTO_POST = setting;
			env.NODE_ENV = nodeEnv;
			const info = await getServerInfo(NO_PUSH);
			expect(info.features.autoPost).toBe(expected);
			expect(info.features.autoPost).toBe(autoPostEnabled());
		},
	);

	it("says the confirm takes auto, whatever the auto-post setting", async () => {
		for (const setting of ["true", "false"]) {
			env.RECURRING_AUTO_POST = setting;
			expect((await getServerInfo(NO_PUSH)).features.autoConfirm).toBe(true);
		}
	});

	it("says the server takes the account and transfer writes a phone queues", async () => {
		expect((await getServerInfo(NO_PUSH)).features.wealthWrites).toBe(true);
	});

	it("says whether the server takes the category writes a phone queues, from CATEGORY_WRITES and nowhere else", async () => {
		expect((await getServerInfo(NO_PUSH)).features.categoryWrites).toBe(true);
		flags.categoryWrites = false;
		try {
			expect((await getServerInfo(NO_PUSH)).features.categoryWrites).toBe(
				false,
			);
		} finally {
			flags.categoryWrites = true;
		}
	});

	it("leaves the other features alone", async () => {
		env.ADVANCED_PROTECTION_ENABLED = true;
		const info = await getServerInfo(NO_PUSH);
		expect(info.features).toEqual({
			advancedProtection: true,
			autoPost: true,
			autoConfirm: true,
			wealthWrites: true,
			categoryWrites: true,
		});
		env.ADVANCED_PROTECTION_ENABLED = false;
	});
});
