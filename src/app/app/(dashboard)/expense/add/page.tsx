"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ExpenseModal } from "~/components/expense-modal";
import { generateId } from "~/lib/utils";

export default function AddExpensePage() {
	const router = useRouter();
	const [expenseId, setExpenseId] = useState<string | null>(null);

	useEffect(() => {
		setExpenseId(generateId());
	}, []);

	if (!expenseId) return null;

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
