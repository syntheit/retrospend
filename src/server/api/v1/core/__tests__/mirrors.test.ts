/**
 * The contract package cannot import app code, so a few lists are copied
 * into it. These tests keep each copy equal to its source, and pin the
 * cursor and error helpers the G1 groups share.
 */
import {
	CATEGORY_COLORS,
	LANGUAGES,
	NOTIFICATION_TYPES,
	profileBackgroundSchema,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { SUPPORTED_LOCALES } from "~/i18n/locales";
import { backgroundSettingsSchema } from "~/lib/background-settings";
import { CATEGORY_COLORS as APP_COLORS } from "~/lib/constants";
import {
	decodeCursor,
	encodeCursor,
	InvalidCursorError,
	toPage,
} from "~/server/services/api-v1/cursor";
import { NotificationType } from "~prisma";
import { toProblem } from "../serve";

describe("contract copies", () => {
	it("languages match SUPPORTED_LOCALES", () => {
		expect([...LANGUAGES]).toEqual([...SUPPORTED_LOCALES]);
	});

	it("category colors match the app's", () => {
		expect([...CATEGORY_COLORS]).toEqual([...APP_COLORS]);
	});

	it("notification types match the Prisma enum", () => {
		expect([...NOTIFICATION_TYPES].sort()).toEqual(
			Object.values(NotificationType).sort(),
		);
	});

	it("the profile background matches the app's schema", () => {
		// A fresh object from the shape drops the contract's component id.
		expect(z.toJSONSchema(z.object(profileBackgroundSchema.shape))).toEqual(
			z.toJSONSchema(backgroundSettingsSchema),
		);
	});
});

describe("cursors", () => {
	const key = z.object({ name: z.string(), id: z.string() });

	it("round-trips a key and refuses anything else", () => {
		const c = encodeCursor({ name: "Café", id: "c1" });
		expect(decodeCursor(c, key)).toEqual({ name: "Café", id: "c1" });
		expect(decodeCursor(undefined, key)).toBeNull();
		expect(() => decodeCursor("%%%", key)).toThrow(InvalidCursorError);
		expect(() => decodeCursor(encodeCursor({ other: 1 }), key)).toThrow(
			InvalidCursorError,
		);
	});

	it("pages limit + 1 rows: the extra row only says there is more", () => {
		const rows = [1, 2, 3].map((n) => ({ id: `r${n}` }));
		const more = toPage(
			rows,
			2,
			(r) => r,
			(r) => r.id,
		);
		expect(more.items).toEqual(["r1", "r2"]);
		expect(
			decodeCursor(more.nextCursor ?? "", z.object({ id: z.string() })),
		).toEqual({
			id: "r2",
		});
		expect(
			toPage(
				rows.slice(0, 2),
				2,
				(r) => r,
				(r) => r.id,
			).nextCursor,
		).toBeNull();
	});
});

describe("service errors", () => {
	const codeOf = (e: unknown) => (toProblem(e) as { code?: string }).code;

	it("maps the codes services throw to problem codes", () => {
		expect(codeOf(new TRPCError({ code: "NOT_FOUND" }))).toBe("not_found");
		expect(codeOf(new TRPCError({ code: "CONFLICT" }))).toBe("conflict");
		expect(codeOf(new TRPCError({ code: "BAD_REQUEST" }))).toBe("bad_request");
		expect(codeOf(new TRPCError({ code: "FORBIDDEN" }))).toBe("forbidden");
		expect(codeOf(new TRPCError({ code: "TOO_MANY_REQUESTS" }))).toBe(
			"conflict",
		);
		expect(codeOf(new InvalidCursorError())).toBe("bad_request");
	});

	it("leaves anything else alone, so it stays a bare internal error", () => {
		const boom = new Error("db password is hunter2");
		expect(toProblem(boom)).toBe(boom);
		const internal = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
		expect(toProblem(internal)).toBe(internal);
	});
});
