"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { isDefaultCategoryKey } from "~/lib/constants";

export function useCategoryName() {
	const t = useTranslations("categoryNames");

	const displayName = useCallback(
		(name: string): string => {
			return isDefaultCategoryKey(name) ? t(name) : name;
		},
		[t],
	);

	const toDbName = useCallback(
		(currentDbName: string, displayInput: string): string => {
			if (isDefaultCategoryKey(currentDbName) && displayInput === t(currentDbName)) {
				return currentDbName;
			}
			return displayInput;
		},
		[t],
	);

	return { displayName, toDbName };
}
