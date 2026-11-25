import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AdminFailureError } from "~/server/services/admin-failure";
import { RateOutOfRangeError } from "~/server/services/payments/rate-band";
import { ShareAnswerRefusedError } from "~/server/services/shared-expenses/answer-guard";
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
	slip: t.procedure.mutation(() => {
		throw new RateOutOfRangeError(
			"That ARS rate is too far from the stored rate.",
		);
	}),
	locked: t.procedure.mutation(() => {
		throw new ShareAnswerRefusedError("share_locked", "This expense is settled.");
	}),
	mailRefused: t.procedure.mutation(() => {
		throw new AdminFailureError("email_auth_failed");
	}),
	backupRunning: t.procedure.mutation(() => {
		throw new AdminFailureError("backup_running");
	}),
	mailBug: t.procedure.mutation(() => {
		throw new Error("535 5.7.8 ana@example.com rejected by smtp.example.com");
	}),
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

	it("names the refusals the web shows in its own words", async () => {
		const slip = await call("slip");
		expect(slip.status).toBe(400);
		expect(slip.body.error.data.problem).toBe("rate_out_of_range");
		const locked = await call("locked");
		expect(locked.status).toBe(409);
		expect(locked.body.error.data.problem).toBe("share_locked");
		expect((await call("fail")).body.error.data.problem).toBeNull();
	});

	it("names an admin failure by its code and says only the fixed sentence", async () => {
		const mail = await call("mailRefused");
		expect(mail.status).toBe(502);
		expect(mail.body.error.data.problem).toBe("email_auth_failed");
		expect(mail.body.error.message).toBe("The email server refused the sign-in.");
		const backup = await call("backupRunning");
		expect(backup.status).toBe(409);
		expect(backup.body.error.data.problem).toBe("backup_running");
	});

	it("keeps an error it does not know masked, with no code", async () => {
		const { status, body } = await call("mailBug");
		expect(status).toBe(500);
		expect(body.error.data.problem).toBeNull();
		expect(JSON.stringify(body)).not.toMatch(/ana@|smtp\.example|535/);
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
