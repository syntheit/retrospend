"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { ActionMenu } from "~/components/actions/action-menu";
import { IconTile, Row, RowList, RowSub } from "~/components/rows/row";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import { formatDateOnly } from "~/lib/date";
import { cn } from "~/lib/cn";
import { SectionUnavailable } from "../section-shell";
import {
	type ApiToken,
	isExpired,
	orderScopes,
} from "./tokens";

/** The words for a token's scopes ("Read, Expenses") and its dates. */
export function useTokenWords() {
	const t = useTranslations("settingsV2.developer");
	const dates = useDateFormat();
	return {
		day: (d: Date) => dates.medium(formatDateOnly(d)),
		scopes: (scopes: ApiToken["scopes"]) =>
			orderScopes(scopes)
				.map((s) => t(`scope.${s.replace(":", "_")}`))
				.join(", ") || t("noScopes"),
	};
}

/** A sub-list of the section: its heading, then loading, error, empty or rows. */
export function TokenBlock({
	title,
	first,
	action,
	state,
	empty,
	children,
}: {
	title: string;
	first?: boolean;
	/** One small secondary Button at the end of the heading (New API key). */
	action?: ReactNode;
	state: {
		isLoading: boolean;
		isError: boolean;
		count: number;
		retry: () => void;
	};
	empty: { title: string; hint: string };
	children: ReactNode;
}) {
	return (
		<>
			<div className={cn("mb-1 flex min-h-ctl items-center gap-3", !first && "mt-6")}>
				<h3 className="flex-1 font-semibold text-fg-2 text-small">{title}</h3>
				{action}
			</div>
			{state.isLoading ? (
				<SkeletonRows count={1} />
			) : state.isError ? (
				<SectionUnavailable onRetry={state.retry} />
			) : state.count === 0 ? (
				<Empty className="py-6" hint={empty.hint} title={empty.title} />
			) : (
				<RowList label={title}>{children}</RowList>
			)}
		</>
	);
}

export function KeyRow({
	token: k,
	onRevoke,
}: {
	token: ApiToken;
	onRevoke: () => void;
}) {
	const t = useTranslations("settingsV2.developer");
	const w = useTokenWords();
	return (
		<Row
			actions={
				<ActionMenu
					entity="apiKey"
					handlers={{ revoke: onRevoke }}
					target={{ id: k.id, name: k.name }}
				/>
			}
			lead={<IconTile icon={KeyRound} />}
			sub={
				<RowSub
					parts={[
						k.start && <span className="font-mono">{`${k.start}…`}</span>,
						w.scopes(k.scopes),
						isExpired(k)
							? t("expired")
							: k.expiresAt
								? t("expiresOn", { date: w.day(k.expiresAt) })
								: null,
						k.lastUsedAt
							? t("lastUsed", { date: w.day(k.lastUsedAt) })
							: t("neverUsed"),
					]}
				/>
			}
			title={k.name}
		/>
	);
}
