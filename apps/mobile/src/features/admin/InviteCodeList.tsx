import { ScrollView } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { SkeletonRows } from "@/ui/Skeleton";
import { StatusText } from "@/ui/StatusText";
import type { InviteCodeDto } from "./types";
import type { AdminState } from "./useAdminRead";

export type InviteStatus = "active" | "used";
export const INVITE_STATUSES: InviteStatus[] = ["active", "used"];

/** Codes are read 100 at a time, up to a cap no self-hosted server reaches. */
export const INVITE_PAGE = 100;
export const INVITE_MAX_PAGES = 5;

/**
 * Reads every page of codes (up to the cap) with the given list call, which is
 * the admin's (every code) or the person's own (their codes).
 */
export async function readInviteCodes(
	list: (query: {
		status: InviteStatus;
		limit: number;
		cursor?: string;
	}) => Promise<{ items: InviteCodeDto[]; nextCursor: string | null }>,
	status: InviteStatus,
): Promise<InviteCodeDto[]> {
	const items: InviteCodeDto[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < INVITE_MAX_PAGES; page++) {
		const read = await list({ status, limit: INVITE_PAGE, cursor });
		items.push(...read.items);
		if (!read.nextCursor) break;
		cursor = read.nextCursor;
	}
	return items;
}

/**
 * The Active or Used chips and the codes under them, newest first. Shared by
 * the admin's list (every code, with who made it) and a person's own (just
 * theirs, so the row says when, not who).
 */
export function InviteCodeList({
	codes,
	status,
	onStatus,
	onOpen,
	mine,
}: {
	codes: { state: AdminState<InviteCodeDto[]>; reload: () => Promise<void> };
	status: InviteStatus;
	onStatus: (status: InviteStatus) => void;
	onOpen: (id: string) => void;
	mine?: boolean;
}) {
	const t = useTranslations("mobile.admin.invites");
	const tc = useTranslations("mobile.common");
	const format = useFormatter();
	const { space } = useTheme();
	const items = codes.state.status === "ready" ? codes.state.data : null;
	const day = (iso: string) =>
		format.dateTime(new Date(iso), { dateStyle: "medium" });
	return (
		<>
			<ScrollView
				contentContainerStyle={{
					alignItems: "center",
					gap: space[2],
					paddingHorizontal: space[4],
					paddingBottom: space[3],
				}}
				horizontal
				showsHorizontalScrollIndicator={false}
			>
				{INVITE_STATUSES.map((id) => (
					<Chip
						key={id}
						label={t(`status.${id}`)}
						onPress={() => onStatus(id)}
						selected={status === id}
					/>
				))}
			</ScrollView>
			{items === null ? (
				codes.state.status === "error" ? (
					<EmptyState
						actionLabel={tc("retry")}
						detail={t("errorDetail")}
						onAction={() => void codes.reload()}
						title={t("error")}
					/>
				) : (
					<SkeletonRows />
				)
			) : items.length === 0 ? (
				<EmptyState title={t(`empty.${status}`)} />
			) : (
				<ListGroup>
					{items.map((code) => (
						<ListRow
							end={
								<StatusText
									label={t(`status.${code.state}`)}
									size="sm"
									tone={code.state === "active" ? "quiet" : "muted"}
								/>
							}
							key={code.id}
							onPress={() => onOpen(code.id)}
							sub={
								code.usedBy && code.usedAt
									? t("usedBy", {
											name: code.usedBy.username ?? code.usedBy.name,
											date: day(code.usedAt),
										})
									: mine
										? t("createdOn", { date: day(code.createdAt) })
										: t("createdBy", {
												name: code.createdBy.username ?? code.createdBy.name,
												date: day(code.createdAt),
											})
							}
							title={code.code}
						/>
					))}
				</ListGroup>
			)}
		</>
	);
}
