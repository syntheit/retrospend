import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { PROBLEM_CONTENT_TYPE, problemSchema } from "./common/errors";
import {
	API_PREFIX,
	type ContractEntry,
	listContractRoutes,
} from "./common/meta";
import { moneySchema } from "./common/money";
import { isSessionScope } from "./common/scopes";
import { contract } from "./index";
import { V1_ALLOWED } from "./protection/v1-allowed";

type JsonObject = Record<string, unknown>;

/**
 * The contract's own version (info.version). Bump the minor for additive
 * changes and the patch for docs only; a breaking change needs /api/v2.
 * 1.1.0: x-protected-account on every operation.
 * 1.2.0: POST /me/protection/enable takes the recovery proof (recoveryAuthKey).
 * 1.3.0: PUT and DELETE /expenses/{id} and their previews take expectedUpdatedAt; 409 expense_changed.
 * 1.4.0: POST /me/protection/keys/open releases the password-opened key wraps.
 * 1.5.0: POST /auth/recovery/check, /auth/recovery/begin and /auth/recovery set a new password with the recovery key; 404 invalid_token, 400 wrong_recovery_key, 409 recovery_unavailable.
 * 1.6.0: POST /me/protection/recovery-key replaces the recovery wrap and proof (event user.recovery_key_replaced).
 * 1.7.0: POST /auth/password-reset mails a reset code and POST /auth/password-reset/code swaps it for a recovery token (recovery only).
 * 1.8.0: DELETE /categories/{id} and POST /categories/{id}/merge return an undo token and have previews; POST /categories/undo takes it back; 409 category_kind_mismatch, category_closed_month and category_income_rule.
 * 1.9.0: POST /recurring/{id}/confirm and /skip, and their previews, answer a period already posted or skipped with 409 recurring_already_posted and one not due yet with 409 recurring_not_due (both were 409 conflict).
 * 1.10.0: POST /recurring and POST /recurring/{id}/confirm take a client id (id, expenseId); confirm, skip, their previews and PATCH /recurring/{id} take expectedUpdatedAt (409 recurring_changed); confirm and skip return templateUpdatedAt.
 * 1.11.0: GET /server-info features.autoPost says whether the server's recurring auto-post is on.
 * 1.12.0: POST /recurring/{id}/confirm returns expenseUpdatedAt, the booked expense's updatedAt (null for recurring income).
 */
export const CONTRACT_VERSION = "1.12.0";

const PROTECTION_OVERVIEW = [
	"Accounts with Advanced protection.",
	"An account with Advanced protection on can call only the operations marked `x-protected-account: { allowed: true }`. Every other operation answers 403 with the code `protected_account`. A public operation is allowed.",
	"For an account with Advanced protection on, GET /events returns only the event types that carry no personal ids or amounts, plus the bare copies of other people's shared writes. For every account, `vault.changed` events reach only callers that hold the `vault` scope.",
	"Sealed records move through GET /vault/changes and POST /vault/writes. The server stores them and cannot open them.",
	"An account with protection keys changes its password with POST /me/protection/password/begin and POST /me/protection/password. POST /me/password answers 403 `protected_password` for it. A change that needs a recent sign-in answers 403 `session_not_fresh`.",
	"POST /auth/prelogin tells a client whether to derive the sign-in secret from the password before it signs in.",
	"A person who forgot the password of an account with protection keys sets a new one with the recovery key, from the link in the reset email: POST /auth/recovery/check, POST /auth/recovery/begin and POST /auth/recovery. They are public, take the token from the link, and ignore any session sent with them. An unusable link is 404 `invalid_token`, a wrong recovery key 400 `wrong_recovery_key`, and keys made before the recovery proof existed 409 `recovery_unavailable`. A successful recovery signs out every session and deletes the account's API keys.",
	"A phone has no link to open. POST /auth/password-reset mails an 8-character code (the same answer for every address), and POST /auth/password-reset/code swaps it for a recovery token that the three recovery routes accept in place of a link's token. The token opens recovery with the recovery key only, never the plain password reset. A code gets 5 tries an hour per account, and the sixth is 429.",
	"An account with protection keys makes a new recovery key with POST /me/protection/recovery-key, which needs the current sign-in secret and replaces the recovery wrap and proof together; the old recovery key stops working when it commits.",
].join("\n\n");

const PROBLEM_REF = { $ref: "#/components/schemas/Problem" };

const SECURITY_SCHEMES = {
	bearerAuth: {
		type: "http",
		scheme: "bearer",
		description:
			"A session token from sign-in or device authorization, or an API key.",
	},
	apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
	cookieAuth: {
		type: "apiKey",
		in: "cookie",
		name: "better-auth.session_token",
	},
};

function problemResponse(description: string) {
	return {
		description,
		content: { [PROBLEM_CONTENT_TYPE]: { schema: PROBLEM_REF } },
	};
}

/**
 * Whether an account with Advanced protection on may call the operation: the
 * same rule the server applies (v1 middleware). A public route is never
 * checked; any other route must be on the list.
 */
export function isProtectedAllowed(entry: ContractEntry): boolean {
	return (
		entry.meta.scope === "public" ||
		Object.hasOwn(V1_ALLOWED, `${entry.method} ${entry.path}`)
	);
}

/**
 * Error responses every operation can return, all as problem+json. They
 * replace the generator's own error bodies, which use oRPC's shape.
 */
function errorResponses(entry: ContractEntry): JsonObject {
	const base: JsonObject = {
		"400": problemResponse("Bad request or validation failed"),
		"429": problemResponse("Rate limited; see Retry-After"),
		"500": problemResponse("Server error"),
	};
	if (entry.meta.scope === "public") return base;
	return {
		...base,
		"401": problemResponse("No valid credentials"),
		"403": problemResponse(
			isProtectedAllowed(entry)
				? "Missing scope, or the API is turned off"
				: "Missing scope, the API is turned off, or the account has Advanced protection on (protected_account)",
		),
		// A sync cursor the log cannot honor (sync_reset_required); a snapshot has no cursor.
		...((entry.meta.scope === "sync" && !entry.meta.snapshot) ||
		(entry.meta.scope === "vault" && entry.method === "GET")
			? {
					"410": problemResponse(
						"The cursor is no longer valid; drop these rows and pull again from the start",
					),
				}
			: {}),
	};
}

export function decorateOperation(op: JsonObject, entry: ContractEntry) {
	const scope = entry.meta.scope;
	// A session scope is never on an API key, so that scheme is not offered.
	op.security =
		scope === "public" || !scope
			? []
			: [
					{ bearerAuth: [scope] },
					...(isSessionScope(scope) ? [] : [{ apiKeyAuth: [scope] }]),
					{ cookieAuth: [scope] },
				];
	op["x-required-scope"] = scope ?? null;
	if (entry.meta.event) op["x-event-type"] = entry.meta.event;
	// Only the boolean is published; the reasons stay internal review notes.
	op["x-protected-account"] = { allowed: isProtectedAllowed(entry) };
	const responses = (op.responses ?? {}) as JsonObject;
	for (const status of Object.keys(responses)) {
		if (Number(status) >= 400) delete responses[status];
	}
	op.responses = { ...responses, ...errorResponses(entry) };
	if (
		entry.method !== "GET" &&
		!entry.meta.previewOf &&
		!entry.meta.readsOnly &&
		// A token in the body proves it and the token is single use.
		entry.meta.publicWrite === undefined
	) {
		const params = (op.parameters ?? []) as JsonObject[];
		op.parameters = [
			...params,
			{
				name: "Idempotency-Key",
				in: "header",
				required: true,
				schema: { type: "string", maxLength: 255 },
			},
		];
	}
}

/**
 * Builds openapi.json from the contract. The output is deterministic (no
 * timestamps, stable key order) so the committed file can be diffed in CI.
 */
export async function generateOpenApiDocument() {
	const generator = new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	});
	const doc = (await generator.generate(contract, {
		info: {
			title: "Retrospend API",
			version: CONTRACT_VERSION,
			description: `The public Retrospend API. Errors are RFC 9457 problem+json with a stable \`code\`. Every write needs an \`Idempotency-Key\`.\n\n${PROTECTION_OVERVIEW}`,
		},
		servers: [{ url: API_PREFIX }],
		commonSchemas: {
			Money: { schema: moneySchema },
			Problem: { schema: problemSchema },
		},
	})) as unknown as JsonObject;

	const components = (doc.components ?? {}) as JsonObject;
	components.securitySchemes = SECURITY_SCHEMES;
	doc.components = components;

	const paths = (doc.paths ?? {}) as Record<string, Record<string, JsonObject>>;
	for (const entry of listContractRoutes(contract)) {
		const op = entry.path
			? paths[entry.path]?.[entry.method.toLowerCase()]
			: undefined;
		if (!op) throw new Error(`No OpenAPI operation for ${entry.key.join(".")}`);
		decorateOperation(op, entry);
	}
	return doc;
}

/** Stable JSON: sorted object keys, tab indent, trailing newline. */
export function stableStringify(value: unknown): string {
	const sort = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sort);
		if (v && typeof v === "object") {
			return Object.fromEntries(
				Object.keys(v as JsonObject)
					.sort()
					.map((k) => [k, sort((v as JsonObject)[k])]),
			);
		}
		return v;
	};
	return `${JSON.stringify(sort(value), null, "\t")}\n`;
}
