"use client";

import { useTranslations } from "next-intl";
import { Row, RowSub } from "~/components/rows/row";
import { api } from "~/trpc/react";
import { TokenBlock, useTokenWords } from "../developer/token-rows";

/**
 * Admin access: each time an admin did something to this account (reset the
 * password, turned it off, changed AI access), newest first. Read only; the
 * server writes the rows and the account cannot change or delete them.
 */
export function AdminAccessBlock() {
	const t = useTranslations("settingsV2.security.adminAccess");
	const w = useTokenWords();
	const log = api.adminAccess.list.useQuery();

	return (
		<TokenBlock
			empty={{ title: t("none"), hint: "" }}
			state={{
				isLoading: log.isLoading,
				isError: log.isError,
				count: log.data?.length ?? 0,
				retry: () => void log.refetch(),
			}}
			title={t("title")}
		>
			{log.data?.map((entry) => (
				<Row
					key={entry.id}
					sub={<RowSub parts={[w.day(entry.createdAt)]} />}
					title={t(`action.${entry.action}`)}
				/>
			))}
		</TokenBlock>
	);
}
