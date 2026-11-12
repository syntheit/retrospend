/**
 * Row ids for creates that seal (E2EE D11 PR 4.2, docs/roadmap/e2ee-d11-pr4.md
 * section 2). A sealed cell's AAD names its row, so the id must be known
 * before the insert: a create that gives none gets one here, made the way the
 * model's own `@id` default would. Prisma's generator is not exported, and the
 * runtime data model does not say which default a model has, so the table is
 * written by hand; row-id.test.ts holds it to prisma/schema.prisma.
 */
import { randomBytes } from "node:crypto";
import { FieldCryptoError } from "./field-crypto";
import type { JsonModel, MappedModel } from "./fields";

/** `cuid`: the id is `@default(cuid())`. `none`: callers always name it. */
export const ID_DEFAULT: Record<MappedModel | JsonModel, "cuid" | "none"> = {
	Apikey: "none",
	AssetAccount: "cuid",
	AuditLogEntry: "cuid",
	BillingPeriod: "cuid",
	BudgetBook: "cuid",
	BudgetMovement: "none",
	Category: "cuid",
	Envelope: "cuid",
	EnvelopeChange: "none",
	EnvelopeGroup: "cuid",
	Expense: "cuid",
	ExportJob: "cuid",
	Feedback: "cuid",
	FixRequest: "none",
	GuestSession: "cuid",
	IdempotencyKey: "cuid",
	ImportJob: "cuid",
	IncomeRule: "none",
	Payment: "none",
	PaymentMethod: "cuid",
	Project: "cuid",
	PushDevice: "cuid",
	RecurringTemplate: "cuid",
	Settlement: "cuid",
	ShadowProfile: "cuid",
	SharedTransaction: "cuid",
	SplitParticipant: "cuid",
	Transfer: "cuid",
	User: "cuid",
	WealthTransfer: "none",
	Webhook: "cuid",
};

const BASE = 36;
const COUNTER_SPAN = BASE ** 4;
let counter = randomBytes(4).readUInt32BE() % COUNTER_SPAN;

/**
 * A cuid-shaped id: `c`, the time in base 36, a process counter and 64 random
 * bits. The `z.cuid()` validators on ids (`^[cC][^\s-]{8,}$`) accept it, where
 * a UUID would fail them. The random part makes ids from two processes in the
 * same millisecond differ, so no host fingerprint is needed.
 */
export function newCuid(): string {
	counter = (counter + 1) % COUNTER_SPAN;
	const time = Date.now().toString(BASE).padStart(8, "0");
	const count = counter.toString(BASE).padStart(4, "0");
	const random = randomBytes(8)
		.readBigUInt64BE()
		.toString(BASE)
		.padStart(13, "0");
	return `c${time}${count}${random}`;
}

/** The id a create of `model` that names none is stored under. */
export function newRowId(model: string): string {
	if ((ID_DEFAULT as Record<string, string>)[model] === "cuid")
		return newCuid();
	throw new FieldCryptoError("missing_row_id");
}
