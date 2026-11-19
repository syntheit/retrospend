/**
 * What a client reads when a procedure fails: the real procedure builder
 * (timing middleware, error formatter) behind the real fetch handler, with
 * routes that fail the ways production routes do. No personal data, file
 * path or database text may reach the response.
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock:5432/mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "test-secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));
vi.mock("~/server/db", () => ({ db: {}, createUserScopedDb: vi.fn() }));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

import { describeInternalError } from "~/server/api/error-formatter";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { Prisma } from "~prisma";

const PATH = "/home/someone/checkout/src/server/services/expense.ts:42";

const unique = (meta: Record<string, unknown>) =>
	new Prisma.PrismaClientKnownRequestError(
		`Invalid \`prisma.expense.create()\` invocation in ${PATH}\n\nUnique constraint failed on the fields: (\`id\`)`,
		{ code: "P2002", clientVersion: "test", meta },
	);

const router = createTRPCRouter({
	crash: publicProcedure.mutation(() => {
		throw new Error(`ENOENT: no such file ${PATH} for "Dinner with Ana"`);
	}),
	crashOnPurpose: publicProcedure.mutation(() => {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Backup failed: ${PATH}`,
		});
	}),
	takenId: publicProcedure.mutation(() => {
		throw unique({ modelName: "Expense", target: ["id"] });
	}),
	takenName: publicProcedure.mutation(() => {
		throw unique({ modelName: "Category", target: ["userId", "name"] });
	}),
	refused: publicProcedure.mutation(() => {
		throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
	}),
});

async function call(path: string) {
	const res = await fetchRequestHandler({
		endpoint: "/api/trpc",
		router,
		createContext: () => ({}) as never,
		req: new Request(`http://localhost/api/trpc/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(null),
		}),
	});
	const text = await res.text();
	return { status: res.status, text, body: JSON.parse(text).error.json };
}

describe("what a client reads from a failed procedure", () => {
	it("an unexpected error is a generic message with no path or text", async () => {
		const { status, text, body } = await call("crash");
		expect(status).toBe(500);
		expect(body.message).toBe("Something went wrong");
		expect(body.data.code).toBe("INTERNAL_SERVER_ERROR");
		expect(text).not.toContain("/home");
		expect(text).not.toContain("stack");
		expect(text).not.toContain("Dinner");
		expect(text).not.toContain("ENOENT");
	});

	it("an internal error thrown with its own text is masked too", async () => {
		const { body, text } = await call("crashOnPurpose");
		expect(body.message).toBe("Something went wrong");
		expect(text).not.toContain("/home");
	});

	it("a taken id is a conflict in the words v1 uses, with no database text", async () => {
		const { status, text, body } = await call("takenId");
		expect(status).toBe(409);
		expect(body.message).toBe("That id is already used");
		expect(body.data.problem).toBe("id_taken");
		expect(text).not.toContain("/home");
		expect(text).not.toContain("prisma");
	});

	it("another taken key is a conflict that does not claim the id", async () => {
		const { status, body } = await call("takenName");
		expect(status).toBe(409);
		expect(body.message).toBe("That id or name is already used");
		expect(body.data.problem).toBe("conflict");
	});

	it("a refusal the code threw on purpose keeps its message", async () => {
		const { status, body } = await call("refused");
		expect(status).toBe(404);
		expect(body.message).toBe("Project not found");
	});
});

describe("the server's line about an unexpected failure", () => {
	it("names the error and the frames, not its message", () => {
		const cause = new Error(`failed for "Dinner with Ana" in ${PATH}`);
		const line = describeInternalError(
			"entry.expense.create.save",
			new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
		);
		expect(line).toContain("[trpc] entry.expense.create.save failed: Error");
		expect(line).toContain("    at ");
		expect(line).not.toContain("Dinner");
		expect(line).not.toContain(PATH);
	});

	it("skips a multi-line message that looks like stack frames", () => {
		const cause = new Error(
			"row failed:\n    at the beach with Ana\n    at Lucia's flat",
		);
		const line = describeInternalError(
			"x",
			new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
		);
		expect(line).toContain("    at ");
		expect(line).not.toContain("beach");
		expect(line).not.toContain("Ana");
		expect(line).not.toContain("Lucia");
	});

	it("gives no frames when the stack does not carry the message", () => {
		const cause = new Error("secret");
		cause.stack = "Error: other\n    at somewhere (file.ts:1:1)";
		const line = describeInternalError(
			"x",
			new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }),
		);
		expect(line).not.toContain("somewhere");
	});

	it("adds the database's code and table", () => {
		const line = describeInternalError(
			"x",
			new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				cause: new Prisma.PrismaClientKnownRequestError("secret value", {
					code: "P2003",
					clientVersion: "test",
					meta: { modelName: "Expense" },
				}),
			}),
		);
		expect(line).toContain("PrismaClientKnownRequestError P2003 Expense");
		expect(line).not.toContain("secret value");
	});
});
