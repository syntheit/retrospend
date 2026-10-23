import { describe, expect, it } from "vitest";
import type { LedgerRowDTO, PaymentDTO } from "~/features/people/types";
import {
	byMonth,
	ledgerItems,
	matchesItem,
	NO_LEDGER_FILTERS,
} from "./ledger-filter";

const ars = (minor: number) => ({ minor, currency: "ARS" });

function row(
	id: string,
	date: string,
	o: Partial<LedgerRowDTO> = {},
): LedgerRowDTO {
	return {
		id,
		title: id,
		date,
		amount: ars(1000),
		category: { name: "Restaurantes", icon: null, tone: 1 },
		project: null,
		paidBy: "me",
		payerName: "Sofía",
		payerId: "user:me",
		people: [],
		effect: ars(500),
		state: "ok",
		canEdit: true,
		...o,
	};
}

function payment(
	id: string,
	paidOn: string,
	o: Partial<PaymentDTO> = {},
): PaymentDTO {
	return {
		id,
		rowId: null,
		direction: "in",
		amount: ars(500),
		paidOn,
		method: "cash",
		status: "final",
		recordedByMe: true,
		parts: [{ project: null, amount: ars(500), offset: false }],
		...o,
	};
}

const ASADO = row("Asado", "2026-10-12");
const BARCO = row("Barco", "2026-09-30", {
	project: { id: "p1", name: "Floripa" },
	paidBy: "them",
	effect: ars(-700),
});
const LOCKED = row("Cena", "2026-10-12", { state: "settled" });
const REVIEW = row("Hotel", "2026-10-01", { state: "review", paidBy: "them" });
const PAID = payment("pay1", "2026-10-12");
const PENDING = payment("pay2", "2026-10-02", {
	status: "pending",
	direction: "out",
});

describe("ledgerItems and byMonth", () => {
	it("merges newest first, payments before expenses on one day, then groups months", () => {
		const items = ledgerItems([BARCO, ASADO], [PAID]);
		expect(
			items.map((i) => (i.kind === "expense" ? i.row.id : i.payment.id)),
		).toEqual(["pay1", "Asado", "Barco"]);
		expect(byMonth(items).map((g) => [g.month, g.items.length])).toEqual([
			["2026-10", 2],
			["2026-09", 1],
		]);
	});
});

describe("matchesItem", () => {
	const f = NO_LEDGER_FILTERS;
	const exp = (r: LedgerRowDTO) => ({
		kind: "expense" as const,
		date: r.date,
		row: r,
	});
	const pay = (p: PaymentDTO) => ({
		kind: "payment" as const,
		date: p.paidOn,
		payment: p,
	});
	it("Outstanding keeps open expenses and pending payments", () => {
		const on = { ...f, outstanding: true };
		expect(matchesItem(exp(ASADO), on)).toBe(true);
		expect(matchesItem(exp(LOCKED), on)).toBe(false);
		expect(matchesItem(pay(PENDING), on)).toBe(true);
		expect(matchesItem(pay(PAID), on)).toBe(false);
	});
	it("To review and Payments pick their kind", () => {
		expect(matchesItem(exp(REVIEW), { ...f, review: true })).toBe(true);
		expect(matchesItem(exp(ASADO), { ...f, review: true })).toBe(false);
		expect(matchesItem(pay(PAID), { ...f, payments: true })).toBe(true);
		expect(matchesItem(exp(ASADO), { ...f, payments: true })).toBe(false);
	});
	it("Paid by follows who paid, for payments too", () => {
		expect(matchesItem(exp(BARCO), { ...f, paidBy: "them" })).toBe(true);
		expect(matchesItem(pay(PENDING), { ...f, paidBy: "me" })).toBe(true);
		expect(matchesItem(pay(PAID), { ...f, paidBy: "me" })).toBe(false);
	});
	it("a project scope keeps that project's rows; search ignores accents", () => {
		expect(matchesItem(exp(BARCO), { ...f, scope: "p1" })).toBe(true);
		expect(matchesItem(exp(ASADO), { ...f, scope: "p1" })).toBe(false);
		expect(matchesItem(exp(ASADO), { ...f, scope: "none" })).toBe(true);
		expect(matchesItem(exp(ASADO), { ...f, query: "restaurantes" })).toBe(true);
	});
});
