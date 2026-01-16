"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { ExpenseModal } from "~/components/expense-modal";
import { generateId } from "~/lib/utils";

export default function AddExpensePage() {
	const router = useRouter();
	const expenseId = useMemo(() => generateId(), []);

	return (
		<ExpenseModal
			description="Fill in the details for your expense."
			expenseId={expenseId}
			onOpenChange={(open) => {
				if (!open) {
					router.push("/app");
				}
			}}
			title="New Expense"
		/>
	);
}
