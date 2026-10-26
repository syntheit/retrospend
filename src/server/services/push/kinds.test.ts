import {
	NOTIFICATION_TYPES,
	PUSH_NOTIFICATION_TYPES,
} from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { NotificationType } from "~prisma";
import { PUSH_KINDS } from "./kinds";

describe("push kinds and notification preferences", () => {
	it("every kind is governed by a type that has a push switch, and no switch is idle", () => {
		const governing = new Set(
			Object.values(PUSH_KINDS).map((kind) => kind.preference),
		);
		expect([...governing].sort()).toEqual([...PUSH_NOTIFICATION_TYPES].sort());
	});

	it("the contract lists the types the database has", () => {
		expect([...NOTIFICATION_TYPES].sort()).toEqual(
			Object.values(NotificationType).sort(),
		);
	});
});
