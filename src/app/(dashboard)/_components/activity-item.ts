import type { MoneyValue } from "~/components/money/format";

/** One row of the landing page's demo feed: a personal expense, a shared one or a payment. */
export type ActivityItem = {
	type: "personal" | "shared" | "settlement";
	id: string;
	title: string;
	amount: number;
	currency: string;
	amountInUSD: number | null;
	home?: MoneyValue | null;
	date: Date;
	category: {
		id: string;
		name: string;
		color: string;
		icon: string | null;
	} | null;
	sharedContext?: {
		totalAmount: number;
		participantCount: number;
		paidByName: string;
		paidByAvatarUrl?: string | null;
		paidByType?: string;
		paidById?: string;
		iPayedThis: boolean;
		transactionId: string;
		projectId?: string;
		projectName?: string;
	};
	settlementContext?: {
		direction: "incoming" | "outgoing";
		otherParticipantName: string;
		otherParticipantType?: string;
		otherParticipantId?: string;
		status: string;
		note?: string;
	};
};
