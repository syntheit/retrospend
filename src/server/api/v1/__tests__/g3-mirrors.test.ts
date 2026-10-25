import {
	PARTICIPANT_TYPES,
	PROJECT_ROLES,
	SPLIT_MODES,
	VERIFICATION_STATUSES,
} from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import {
	ParticipantType,
	ProjectRole,
	SplitMode,
	VerificationStatus,
} from "~prisma";

/** The contract package cannot import Prisma, so it mirrors these lists; this keeps them equal. */
describe("G3 contract mirrors", () => {
	it("participant types", () => {
		expect([...PARTICIPANT_TYPES].sort()).toEqual(
			Object.values(ParticipantType).sort(),
		);
	});
	it("project roles", () => {
		expect([...PROJECT_ROLES].sort()).toEqual(
			Object.values(ProjectRole).sort(),
		);
	});
	it("split modes", () => {
		expect([...SPLIT_MODES].sort()).toEqual(Object.values(SplitMode).sort());
	});
	it("verification statuses", () => {
		expect([...VERIFICATION_STATUSES].sort()).toEqual(
			Object.values(VerificationStatus).sort(),
		);
	});
});
