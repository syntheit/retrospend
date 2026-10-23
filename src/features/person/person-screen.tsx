"use client";

import { Banknote, Bell, Plus, Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageFrame } from "~/components/layout/page-frame";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { useToast } from "~/components/ui/toast";
import { firstName } from "~/features/people/filter";
import { NeedsBlock } from "~/features/people/needs-block";
import type { PersonPage } from "~/features/people/types";
import { SettleSheet } from "~/features/settle/settle-sheet";
import { api } from "~/trpc/react";
import { BalanceBlock, directionOf } from "./balance-block";
import { Ledger } from "./ledger";
import { type LedgerFilters, NO_LEDGER_FILTERS } from "./ledger-filter";
import { PersonHeader } from "./person-header";
import { LatestPayments, Scopes } from "./scopes";

/** The settle scope a project row stands for: an id, null for Outside projects. */
const settleScope = (scope: string | null) =>
	scope === null ? undefined : scope === "none" ? null : scope;

/** The Person page (uiV2): balance, payments, Needs you, projects, Between you. */
export function PersonScreen({
	page,
	today,
}: {
	page: PersonPage;
	today: string;
}) {
	const t = useTranslations("personPage");
	const toast = useToast();
	const { openNewExpense } = useExpenseModal();
	const [filters, setFilters] = useState<LedgerFilters>(NO_LEDGER_FILTERS);
	const [settling, setSettling] = useState(false);
	const remind = api.settlement.requestPayment.useMutation();
	const p = page.person;
	// Sentences name them by first name; the header keeps the full name.
	const named = { ...page, person: { ...p, name: firstName(p.name) } };
	const open = directionOf(page) !== null;
	const onRemind = () =>
		remind
			.mutateAsync({ participantType: p.type, participantId: p.id })
			.then(() => toast.saved(t("toast.reminded", { name: named.person.name })))
			.catch((e: unknown) =>
				toast.failed(e instanceof Error ? e.message : t("toast.failed")),
			);
	const canRemind = directionOf(page) === "owed" && p.onRetrospend;

	return (
		<PageFrame label="person">
			<PersonHeader
				onSettle={open ? () => setSettling(true) : undefined}
				page={page}
			/>
			{page.settled.nothingShared && page.rows.length === 0 ? (
				<Empty
					action={
						<Button kind="primary" onClick={() => openNewExpense()} size="sm">
							<Plus aria-hidden="true" />
							{t("addExpense", { name: named.person.name })}
						</Button>
					}
					icon={Receipt}
					title={t("nothingYet", { name: named.person.name })}
				/>
			) : (
				<>
					<div className="mb-8 grid grid-cols-2 items-start gap-12 max-md:grid-cols-1 max-md:gap-6">
						<BalanceBlock
							onRemind={canRemind ? () => void onRemind() : undefined}
							page={named}
							reminding={remind.isPending}
						/>
						<div className="max-md:hidden">
							<LatestPayments page={named} payments={page.payments} />
						</div>
					</div>
					<div className="mb-6 grid grid-cols-3 gap-2 md:hidden">
						{open && (
							<Button kind="primary" onClick={() => setSettling(true)}>
								<Banknote />
								{t("settleUp")}
							</Button>
						)}
						{canRemind && (
							<Button
								disabled={remind.isPending}
								kind="secondary"
								onClick={() => void onRemind()}
							>
								<Bell />
								{t("remindShort")}
							</Button>
						)}
						<Button kind="secondary" onClick={() => openNewExpense()}>
							<Plus />
							{t("expenseShort")}
						</Button>
					</div>
					<NeedsBlock needs={page.needs} />
					<Scopes
						onScope={(scope) => setFilters((f) => ({ ...f, scope }))}
						page={page}
						scope={filters.scope}
					/>
					<Ledger
						filters={filters}
						onFilters={setFilters}
						page={named}
						today={today}
					/>
				</>
			)}
			<SettleSheet
				onClose={() => setSettling(false)}
				person={settling ? named.person : null}
				scope={settleScope(filters.scope)}
			/>
		</PageFrame>
	);
}
