/**
 * The words of a project activity entry. The web gets display text; API
 * clients get the raw parts (see SUMMARY_FORMATS) and format and translate
 * them themselves.
 */
import { formatCurrency } from "@retrospend/domain/currency-format";

function safeFormatAmount(amount: unknown, currency: unknown): string {
	try {
		const n = Number(amount);
		const c = String(currency ?? "USD");
		if (isNaN(n)) return String(amount);
		return formatCurrency(n, c);
	} catch {
		return String(amount);
	}
}

function truncateSummaryText(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}


type SummaryResult = { text: string; key: string | null; params: Record<string, string> | null };

type SummaryMode = "display" | "raw";

/**
 * How the summary words its parts. "display" is the web's text: amounts
 * formatted, names clipped and quoted. "raw" is for API clients, which format
 * and translate themselves: amounts as "<decimal> <currency>", names whole
 * and bare, enum values as stored, nothing where the text would have a
 * stand-in.
 */
const SUMMARY_FORMATS = {
	display: {
		money: (amount: unknown, currency: unknown) =>
			safeFormatAmount(amount, currency),
		clip: truncateSummaryText,
		quote: (s: string) => `'${s}'`,
		fallback: (s: string) => s,
		clipReason: (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s),
		enumText: (s: string) => s.toLowerCase().replace(/_/g, " "),
	},
	raw: {
		money: (amount: unknown, currency: unknown) =>
			`${String(amount)} ${String(currency ?? "USD")}`,
		clip: (s: string) => s,
		quote: (s: string) => s,
		fallback: () => "",
		clipReason: (s: string) => s,
		enumText: (s: string) => s,
	},
} as const;

export function buildActivitySummary(
	action: string,
	targetType: string,
	actorName: string,
	txnDescription: string | null,
	txnCurrency: string | null,
	changes: unknown,
	otherActorName: string | null,
	billingPeriodLabel: string | null,
	mode: SummaryMode = "display",
): SummaryResult {
	const fmt = SUMMARY_FORMATS[mode];
	const c = changes as Record<string, unknown> | null;
	const r = (text: string, key: string, params: Record<string, string>): SummaryResult =>
		({ text, key, params });

	try {
		switch (action) {
			case "CREATED": {
				if (targetType === "SHARED_TRANSACTION") {
					const desc = txnDescription ? fmt.quote(txnDescription) : fmt.fallback("an expense");
					const amt = c ? ` (${fmt.money(c.amount, c.currency)})` : "";
					const text = `${actorName} added ${desc}${amt}`;
					if (c) {
						return r(text, "activityCreatedExpenseWithAmount", { actor: actorName, description: desc, amount: fmt.money(c.amount, c.currency) });
					}
					return r(text, "activityCreatedExpense", { actor: actorName, description: desc });
				}
				if (targetType === "SETTLEMENT") {
					// One entry per project of a payment group (see
					// SettlementService.createPaymentGroup): `amount` is this
					// project's cash, `offsetAmount` what was offset here against
					// another project, `allocatedFromTotal` the whole payment.
					const cash = typeof c?.amount === "number" ? c.amount : 0;
					const offset =
						typeof c?.offsetAmount === "number" ? c.offsetAmount : 0;
					const name = otherActorName ?? "";
					const to = otherActorName ? ` with ${otherActorName}` : "";
					if (c?.squareUp || (cash === 0 && offset > 0)) {
						const amt = fmt.money(offset, c?.currency);
						return r(`${actorName} offset ${amt}${to} against another project`, "activityOffsetSettlement", { actor: actorName, amount: amt, name });
					}
					if (offset > 0) {
						const amt = fmt.money(cash + offset, c?.currency);
						const off = fmt.money(offset, c?.currency);
						return r(`${actorName} initiated a ${amt} settlement${to}, ${off} of it offset against another project`, "activityCreatedSettlementWithOffset", { actor: actorName, amount: amt, offset: off, name });
					}
					const amt = fmt.money(c?.amount, c?.currency);
					if (typeof c?.allocatedFromTotal === "number") {
						const total = fmt.money(c.allocatedFromTotal, c?.currency);
						return r(`${actorName} initiated a ${amt} settlement${to}, part of a ${total} payment`, "activityCreatedSettlementPart", { actor: actorName, amount: amt, total, name });
					}
					return r(`${actorName} initiated a ${amt} settlement${to}`, "activityCreatedSettlement", { actor: actorName, amount: amt, ...(otherActorName ? { name: otherActorName } : {}) });
				}
				if (c?.linkId) {
					return r(`${actorName} created an invite link`, "activityCreatedInviteLink", { actor: actorName });
				}
				return r(`${actorName} created the project`, "activityCreatedProject", { actor: actorName });
			}

			case "EDITED": {
				if (targetType === "SHARED_TRANSACTION") {
					const desc = txnDescription
						? fmt.quote(fmt.clip(txnDescription, 40))
						: fmt.fallback("an expense");
					const amtChange = c?.amount as
						| { old: unknown; new: unknown }
						| undefined;
					const descChange = c?.description as
						| { old: string; new: string }
						| undefined;
					const splitChange = c?.splitParticipants;

					if (amtChange) {
						const currencyChange = c?.currency as
							| { old: string; new: string }
							| undefined;
						const currency = currencyChange?.new ?? txnCurrency ?? "USD";
						const from = fmt.money(amtChange.old, currency);
						const to = fmt.money(amtChange.new, currency);
						if (splitChange) {
							return r(
								`${actorName} changed ${desc} from ${from} to ${to} and updated the split`,
								"activityEditedAmountAndSplit",
								{ actor: actorName, description: desc, from, to },
							);
						}
						return r(
							`${actorName} changed ${desc} from ${from} to ${to}`,
							"activityEditedAmount",
							{ actor: actorName, description: desc, from, to },
						);
					}
					if (descChange) {
						const oldLabel = descChange.old
							? fmt.quote(fmt.clip(descChange.old, 40))
							: fmt.fallback("an expense");
						const newLabel = descChange.new
							? fmt.quote(fmt.clip(descChange.new, 40))
							: fmt.fallback("an expense");
						return r(
							`${actorName} renamed ${oldLabel} to ${newLabel}`,
							"activityRenamedExpense",
							{ actor: actorName, oldName: oldLabel, newName: newLabel },
						);
					}
					if (splitChange) {
						return r(
							`${actorName} updated the split on ${desc}`,
							"activityUpdatedSplit",
							{ actor: actorName, description: desc },
						);
					}
					return r(
						`${actorName} edited ${desc}`,
						"activityEditedExpense",
						{ actor: actorName, description: desc },
					);
				}

				// PROJECT EDITED - parse field-level diff for specific summaries
				const nameChange = c?.name as { old: string; new: string } | undefined;
				const imageChange = c?.imagePath as
					| { old: string | null; new: string | null }
					| undefined;
				const budgetChange = c?.budgetAmount as
					| { old: unknown; new: unknown }
					| undefined;
				const visChange = c?.visibility as
					| { old: string; new: string }
					| undefined;
				const descChange2 = c?.description as
					| { old: unknown; new: unknown }
					| undefined;
				const hasBillingChange = !!(
					c?.billingCycleLength ??
					c?.billingCycleDays ??
					c?.billingAutoClose ??
					c?.billingCloseReminderDays ??
					c?.billingClosePermission
				);

				const labels: string[] = [];
				const labelKeys: string[] = [];
				const labelParams: Record<string, string>[] = [];

				if (nameChange) {
					const from = fmt.clip(String(nameChange.old), 35);
					const to = fmt.clip(String(nameChange.new), 35);
					labels.push(`renamed the project from '${from}' to '${to}'`);
					labelKeys.push("activityRenamedProject");
					labelParams.push({ actor: actorName, oldName: from, newName: to });
				}
				if (imageChange) {
					if (!imageChange.old && imageChange.new) {
						labels.push("added a project icon");
						labelKeys.push("activityAddedProjectIcon");
						labelParams.push({ actor: actorName });
					} else if (imageChange.old && !imageChange.new) {
						labels.push("removed the project icon");
						labelKeys.push("activityRemovedProjectIcon");
						labelParams.push({ actor: actorName });
					} else {
						labels.push("changed the project icon");
						labelKeys.push("activityChangedProjectIcon");
						labelParams.push({ actor: actorName });
					}
				}
				if (budgetChange) {
					if (budgetChange.new == null) {
						labels.push("removed the project budget");
						labelKeys.push("activityRemovedBudget");
						labelParams.push({ actor: actorName });
					} else if (budgetChange.old == null) {
						labels.push("set a project budget");
						labelKeys.push("activitySetBudget");
						labelParams.push({ actor: actorName });
					} else {
						labels.push("changed the project budget");
						labelKeys.push("activityChangedBudget");
						labelParams.push({ actor: actorName });
					}
				}
				if (visChange) {
					const vis = fmt.enumText(String(visChange.new));
					labels.push(`changed project visibility to ${vis}`);
					labelKeys.push("activityChangedVisibility");
					labelParams.push({ actor: actorName, visibility: vis });
				}
				if (descChange2 && !nameChange) {
					labels.push("updated the project description");
					labelKeys.push("activityUpdatedDescription");
					labelParams.push({ actor: actorName });
				}
				if (hasBillingChange && labels.length === 0) {
					labels.push("updated billing period settings");
					labelKeys.push("activityUpdatedBilling");
					labelParams.push({ actor: actorName });
				}

				if (labels.length === 0) return r(`${actorName} updated the project`, "activityUpdatedProject", { actor: actorName });
				if (labels.length === 1) return r(`${actorName} ${labels[0]}`, labelKeys[0]!, labelParams[0]!);
				if (labels.length === 2) {
					return r(
						`${actorName} ${labels[0]} and ${labels[1]}`,
						"activityProjectMultipleChanges",
						{ actor: actorName, count: "2" },
					);
				}
				const extra = labels.length - 2;
				return r(
					`${actorName} ${labels[0]} and ${labels[1]} (and ${extra} more ${extra === 1 ? "change" : "changes"})`,
					"activityProjectMultipleChanges",
					{ actor: actorName, count: String(labels.length) },
				);
			}

			case "DELETED": {
				if (targetType === "SHARED_TRANSACTION") {
					const desc = txnDescription ? fmt.quote(txnDescription) : fmt.fallback("an expense");
					const amt = c?.amount
						? ` (${fmt.money(c.amount, c.currency)})`
						: "";
					const text = `${actorName} deleted ${desc}${amt}`;
					if (c?.amount) {
						return r(text, "activityDeletedExpenseWithAmount", { actor: actorName, description: desc, amount: fmt.money(c.amount, c.currency) });
					}
					return r(text, "activityDeletedExpense", { actor: actorName, description: desc });
				}
				return r(`${actorName} deleted`, "activityMadeChange", { actor: actorName });
			}

			case "VERIFIED":
				return txnDescription
					? r(`${actorName} verified '${txnDescription}'`, "activityVerified", { actor: actorName, description: fmt.quote(txnDescription) })
					: r(`${actorName} verified an expense`, "activityVerified", { actor: actorName, description: fmt.fallback("an expense") });

			case "REJECTED": {
				const reason = typeof c?.reason === "string" ? c.reason : null;
				const desc = txnDescription ? fmt.quote(txnDescription) : fmt.fallback("an expense");
				if (reason) {
					const truncated = fmt.clipReason(reason);
					return r(
						`${actorName} disputed ${desc}: '${truncated}'`,
						"activityRejectedWithReason",
						{ actor: actorName, description: desc, reason: truncated },
					);
				}
				return r(`${actorName} disputed ${desc}`, "activityRejected", { actor: actorName, description: desc });
			}

			case "AUTO_VERIFIED": {
				const days =
					typeof c?.autoAcceptedAfterDays === "number"
						? c.autoAcceptedAfterDays
						: 7;
				const desc = txnDescription ? fmt.quote(txnDescription) : fmt.fallback("An expense");
				return r(`${desc} auto-verified after ${days} days`, "activityAutoVerified", { description: desc, days: String(days) });
			}

			case "SETTLED": {
				if (targetType === "SETTLEMENT") {
					const amt = fmt.money(c?.amount, c?.currency);
					const from = otherActorName ? ` from ${otherActorName}` : "";
					return r(
						`${actorName} confirmed a ${amt} settlement${from}`,
						"activityConfirmedSettlement",
						{ actor: actorName, amount: amt, ...(otherActorName ? { name: otherActorName } : {}) },
					);
				}
				if (targetType === "BILLING_PERIOD") {
					return billingPeriodLabel
						? r(`${actorName} settled the '${billingPeriodLabel}' period`, "activitySettledPeriod", { actor: actorName, period: billingPeriodLabel })
						: r(`${actorName} settled a billing period`, "activitySettledPeriod", { actor: actorName, period: "" });
				}
				return r(`${actorName} settled`, "activityMadeChange", { actor: actorName });
			}

			case "PERIOD_REOPENED":
				// A payment that settled the period was rejected or undone.
				return billingPeriodLabel
					? r(`'${billingPeriodLabel}' was reopened because a payment was rejected or undone`, "activityReopenedPeriod", { period: billingPeriodLabel })
					: r("A billing period was reopened because a payment was rejected or undone", "activityReopenedPeriodGeneric", {});

			case "PERIOD_CLOSED":
				return billingPeriodLabel
					? r(`${actorName} closed the '${billingPeriodLabel}' billing period`, "activityClosedPeriod", { actor: actorName, period: billingPeriodLabel })
					: r(`${actorName} closed a billing period`, "activityClosedPeriod", { actor: actorName, period: "" });

			case "PARTICIPANT_ADDED":
				return otherActorName
					? r(`${actorName} added ${otherActorName} to the project`, "activityAddedParticipant", { actor: actorName, name: otherActorName })
					: r(`${actorName} added a participant`, "activityAddedParticipant", { actor: actorName, name: "" });

			case "PARTICIPANT_REMOVED":
				return otherActorName
					? r(`${actorName} removed ${otherActorName} from the project`, "activityRemovedParticipant", { actor: actorName, name: otherActorName })
					: r(`${actorName} removed a participant`, "activityRemovedParticipant", { actor: actorName, name: "" });

			case "ROLE_CHANGED": {
				const oldRole = typeof c?.oldRole === "string" ? c.oldRole : null;
				const newRole = typeof c?.newRole === "string" ? c.newRole : null;
				const roleStr =
					oldRole && newRole ? ` from ${oldRole} to ${newRole}` : "";
				if (otherActorName) {
					if (oldRole && newRole) {
						return r(
							`${actorName} changed ${otherActorName}'s role${roleStr}`,
							"activityChangedRoleWithRoles",
							{ actor: actorName, name: otherActorName, oldRole, newRole },
						);
					}
					return r(
						`${actorName} changed ${otherActorName}'s role`,
						"activityChangedRole",
						{ actor: actorName, name: otherActorName },
					);
				}
				return r(`${actorName} changed a participant's role`, "activityChangedRole", { actor: actorName, name: "" });
			}

			default:
				return r(`${actorName} made a change`, "activityMadeChange", { actor: actorName });
		}
	} catch {
		return r(`${actorName} made a change`, "activityMadeChange", { actor: actorName });
	}
}
