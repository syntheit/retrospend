import type { ORPCError } from "@orpc/server";
import {
	AmountRefusedError,
	CategoryNotFoundError,
	EditRefusal,
	EXPENSE_NOT_FOUND,
	LEG_DELETE_REFUSED,
} from "@retrospend/domain/expense-write/refusals";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { encodeProblem } from "../../errors";
import { toProblem } from "../serve";

const encoded = (error: unknown) =>
	encodeProblem(toProblem(error) as ORPCError<string, unknown>);

describe("an expense write refusal as problem+json", () => {
	it("a bad category on a write route is 404 not_found", () => {
		expect(encoded(new CategoryNotFoundError("not_found"))).toMatchObject({
			status: 404,
			code: "not_found",
			detail: "Category not found",
		});
	});

	it("a bad category on categorize is 403 forbidden", () => {
		expect(encoded(new CategoryNotFoundError("forbidden"))).toMatchObject({
			status: 403,
			code: "forbidden",
			detail: "Category not found",
		});
	});

	it("is found inside the error a procedure wraps it in", () => {
		const wrapped = new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			cause: new CategoryNotFoundError("forbidden"),
		});
		expect(encoded(wrapped)).toMatchObject({ status: 403, code: "forbidden" });
	});

	it("an amount of 0 or less is 400 bad_request with the domain's words", () => {
		expect(encoded(new AmountRefusedError())).toMatchObject({
			status: 400,
			code: "bad_request",
			detail: "Enter an amount above zero",
		});
	});

	it("a row the edit cannot reach is 404 not_found, a leg-pinned row 400 bad_request", () => {
		expect(
			encoded(new EditRefusal("notFound", EXPENSE_NOT_FOUND)),
		).toMatchObject({
			status: 404,
			code: "not_found",
			detail: EXPENSE_NOT_FOUND,
		});
		expect(
			encoded(new EditRefusal("badRequest", LEG_DELETE_REFUSED)),
		).toMatchObject({
			status: 400,
			code: "bad_request",
			detail: LEG_DELETE_REFUSED,
		});
	});
});
