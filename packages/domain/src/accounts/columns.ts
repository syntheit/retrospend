/**
 * The asset_account columns an account's own fields write (create and edit),
 * as the column text: rates and amounts at their column's scale, half to
 * even. Shared by the server's writer and the device's booking so the stored
 * text is one rule.
 */
import { columnText } from "../money-dec";
import type { DecimalInput } from "../precise-decimal";

export interface AccountFieldValues<Type extends string = string> {
	readonly name: string;
	readonly type: Type;
	readonly currency: string;
	readonly isLiquid: boolean;
	readonly interestRate?: DecimalInput | null;
	readonly minimumPayment?: DecimalInput | null;
	readonly dueDate?: number | null;
	/** "Part of my budget"; undefined leaves the column alone, null is the default for its kind. */
	readonly inBudget?: boolean | null;
}

const column = (value: DecimalInput | null | undefined, scale: number) =>
	value === null || value === undefined ? value : columnText(value, scale);

export function accountColumnsOf<Type extends string>(
	input: AccountFieldValues<Type>,
) {
	return {
		name: input.name,
		type: input.type,
		currency: input.currency,
		isLiquid: input.isLiquid,
		interestRate: column(input.interestRate, 6),
		minimumPayment: column(input.minimumPayment, 8),
		dueDate: input.dueDate,
		...(input.inBudget !== undefined ? { inBudget: input.inBudget } : {}),
	};
}
