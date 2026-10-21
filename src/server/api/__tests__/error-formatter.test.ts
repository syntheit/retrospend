import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorFormatter, zodErrorData } from "../error-formatter";

const t = initTRPC.create({ errorFormatter });

const router = t.router({
	create: t.procedure
		.input(
			z
				.object({
					name: z.string().min(1, "Name is required"),
					email: z.email("Invalid email address"),
					password: z.string(),
					confirm: z.string(),
				})
				.refine((data) => data.password === data.confirm, {
					error: "Passwords do not match",
					path: ["confirm"],
				}),
		)
		.mutation(() => "ok"),
	fail: t.procedure.mutation(() => {
		throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
	}),
});

async function call(path: string, input?: unknown) {
	const res = await fetchRequestHandler({
		endpoint: "/api/trpc",
		router,
		createContext: () => ({}),
		req: new Request(`http://localhost/api/trpc/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input ?? null),
		}),
	});
	return { status: res.status, body: await res.json() };
}

describe("tRPC error formatter", () => {
	it("returns flattened field errors for invalid input", async () => {
		const { status, body } = await call("create", {
			name: "",
			email: "nope",
			password: "a",
			confirm: "b",
		});

		expect(status).toBe(400);
		expect(body.error.data.code).toBe("BAD_REQUEST");
		expect(body.error.data.zodError).toEqual({
			formErrors: [],
			fieldErrors: {
				name: ["Name is required"],
				email: ["Invalid email address"],
				confirm: ["Passwords do not match"],
			},
		});
	});

	it("puts issues without a path under formErrors", async () => {
		const { body } = await call("create", "not an object");

		expect(body.error.data.zodError.fieldErrors).toEqual({});
		expect(body.error.data.zodError.formErrors).toHaveLength(1);
	});

	it("leaves zodError null for other errors", async () => {
		const { status, body } = await call("fail");

		expect(status).toBe(404);
		expect(body.error.message).toBe("Project not found");
		expect(body.error.data.zodError).toBeNull();
	});

	it("only reads ZodError causes", () => {
		expect(zodErrorData(new TRPCError({ code: "BAD_REQUEST" }))).toBeNull();
		expect(
			zodErrorData(
				new TRPCError({ code: "BAD_REQUEST", cause: new Error("plain error") }),
			),
		).toBeNull();
	});
});
