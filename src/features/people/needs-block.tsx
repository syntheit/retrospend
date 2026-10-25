"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Section } from "~/components/layout/section";
import { NeedsYouList } from "~/components/needs-you/needs-you-list";
import type { NeedsYouItemVM } from "~/components/needs-you/types";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { FaceStack } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";
import { firstName } from "./filter";
import { ReviewSheet } from "./review-sheet";
import type { NeedsItemDTO } from "./types";

/** Desktop shows this many before "Show N more"; a phone, fewer. */
const FIRST = { desktop: 5, phone: 3 };

function toItem(n: NeedsItemDTO): NeedsYouItemVM {
	// Each item leads with the face of the person asking (People mockup).
	const face = {
		id: n.person.key,
		name: n.person.name,
		imageUrl: n.person.imageUrl,
	};
	return n.kind === "confirmPayment"
		? {
				kind: "confirmPayment",
				id: n.id,
				person: firstName(n.person.name),
				amount: n.amount,
				face,
			}
		: {
				kind: "verify",
				id: n.id,
				person: firstName(n.person.name),
				title: n.title,
				amount: n.amount,
				face,
			};
}

/** The phone's one row: the faces asking, how many, and the first of them. */
function NeedsSummary({
	needs,
	onOpen,
}: {
	needs: readonly NeedsItemDTO[];
	onOpen: () => void;
}) {
	const t = useTranslations("peoplePage.needs");
	const people = [
		...new Map(needs.map((n) => [n.person.key, n.person])).values(),
	];
	const lead = needs[0];
	return (
		<RowList>
			<Row
				lead={
					<FaceStack
						max={3}
						on="surface"
						people={people.map((p) => ({
							id: p.key,
							name: p.name,
							imageUrl: p.imageUrl,
						}))}
						size="sm"
					/>
				}
				open={{ onOpen, label: t("summary", { count: needs.length }) }}
				sub={
					lead ? (
						<RowSub
							parts={[
								t("summaryMore", {
									first: firstName(lead.person.name),
									count: needs.length - 1,
								}),
							]}
						/>
					) : undefined
				}
				title={t("summary", { count: needs.length })}
			/>
		</RowList>
	);
}

/**
 * Needs you on the People and Person pages: payments someone says they made
 * to you (Confirm, then an Undo toast) and splits someone added you to
 * (Review opens Accept or Reject).
 */
export function NeedsBlock({ needs }: { needs: readonly NeedsItemDTO[] }) {
	const t = useTranslations("peoplePage.needs");
	const toast = useToast();
	const router = useRouter();
	const phone = useIsMobile();
	const [more, setMore] = useState(false);
	const [review, setReview] = useState<NeedsItemDTO | null>(null);
	const [sheet, setSheet] = useState(false);
	const confirm = api.settlement.paymentConfirm.useMutation();
	const unconfirm = api.settlement.paymentUnconfirm.useMutation();
	if (!needs.length) return null;
	// A phone shows one row ("3 need you") that opens the list in a sheet.
	const summary = phone && needs.length > 1;
	const first = phone ? FIRST.phone : FIRST.desktop;
	const shown = more ? needs : needs.slice(0, first);
	const byId = new Map(needs.map((n) => [n.id, n]));

	const onAction = (item: NeedsYouItemVM) => {
		const n = byId.get(item.id);
		if (!n) return;
		if (n.kind === "verify") return setReview(n);
		confirm
			.mutateAsync({ paymentId: n.id })
			.then(() => {
				router.refresh();
				toast.saved(t("confirmed", { name: firstName(n.person.name) }), {
					undo: async () => {
						await unconfirm.mutateAsync({ paymentId: n.id });
						router.refresh();
					},
				});
			})
			.catch((e: unknown) =>
				toast.failed(e instanceof Error ? e.message : t("failed")),
			);
	};

	return (
		<Section
			className="mb-8"
			count={needs.length}
			id="needs-you"
			title={t("title")}
		>
			{summary ? (
				<NeedsSummary needs={needs} onOpen={() => setSheet(true)} />
			) : (
				<>
					<NeedsYouList
						items={shown.map(toItem)}
						onAction={onAction}
						variant={phone ? "group" : "flat"}
					/>
					{needs.length > shown.length && (
						<Button
							className="mt-2"
							kind="ghost"
							onClick={() => setMore(true)}
							size="sm"
						>
							<ChevronDown aria-hidden="true" />
							{t("showMore", { count: needs.length - shown.length })}
						</Button>
					)}
				</>
			)}
			<Sheet
				detent="medium"
				footer={false}
				onOpenChange={setSheet}
				open={summary && sheet}
				title={t("title")}
			>
				<NeedsYouList
					items={needs.map(toItem)}
					onAction={(item) => {
						setSheet(false);
						onAction(item);
					}}
				/>
			</Sheet>
			<ReviewSheet item={review} onClose={() => setReview(null)} />
		</Section>
	);
}
