"use client";

import { useApi } from "@retrospend/api-client/react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { CreateTokenSheet } from "./create-token-sheet";
import { KeyRow, TokenBlock } from "./token-rows";
import { toToken } from "./tokens";

/**
 * Personal API keys: list, create (the key shows once) and revoke. Revoking
 * cannot be undone, so its menu item asks first with a named button.
 */
export function TokensBlock({ isAdmin }: { isAdmin: boolean }) {
	const t = useTranslations("settingsV2.developer");
	const toast = useToast();
	const { utils } = useApi();
	const [creating, setCreating] = useState(false);
	const keys = useInfiniteQuery(
		utils.tokens.list.infiniteOptions({
			input: (cursor: string | undefined) => ({ cursor, limit: 50 }),
			initialPageParam: undefined,
			getNextPageParam: (page) => page.nextCursor ?? undefined,
		}),
	);
	const revoke = useMutation(utils.tokens.revoke.mutationOptions());
	const rows = keys.data?.pages.flatMap((p) => p.items.map(toToken)) ?? [];

	return (
		<>
			<TokenBlock
				action={
					<Button kind="secondary" onClick={() => setCreating(true)} size="sm">
						<Plus aria-hidden="true" />
						{t("newKey")}
					</Button>
				}
				empty={{ title: t("noKeys"), hint: t("noKeysHint") }}
				first
				state={{
					isLoading: keys.isLoading,
					// A failed refetch keeps the rows it has: a row goes only when the server drops it.
					isError: keys.isError && rows.length === 0,
					count: rows.length,
					retry: () => void keys.refetch(),
				}}
				title={t("keys")}
			>
				{rows.map((k) => (
					<KeyRow
						key={k.id}
						onRevoke={() =>
							void revoke.mutateAsync({ id: k.id }).then(
								() => toast.saved(t("revoked", { name: k.name })),
								() => toast.failed(t("failed")),
							)
						}
						token={k}
					/>
				))}
			</TokenBlock>
			{keys.hasNextPage ? (
				<Button
					className="mt-2"
					kind="secondary"
					loading={keys.isFetchingNextPage}
					onClick={() => void keys.fetchNextPage()}
					size="sm"
				>
					{t("showMore")}
				</Button>
			) : null}
			<CreateTokenSheet
				isAdmin={isAdmin}
				onOpenChange={setCreating}
				open={creating}
			/>
		</>
	);
}
