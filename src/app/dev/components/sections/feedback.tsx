"use client";

import { Inbox } from "lucide-react";
import { useEffect } from "react";
import { toast as sonner } from "sonner";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Toaster } from "~/components/ui/sonner";
import { useToast } from "~/components/ui/toast";
import { Cap, Pair, Spec } from "../spec";

/** Sample copy inside the samples: fixtures, like the numbers. */
const S = {
	emptyTitle: "No recurring expenses",
	emptyHint: "Add one to see when it is due.",
	addRecurring: "Add recurring expense",
	importing: "Importing 41 expenses.",
	rate: "Rate for BRL is from Oct 18.",
	server: "Could not reach the server.",
	refresh: "Refresh",
	retry: "Retry",
	toastCap: "Toast with Undo (held in place). Try the live one.",
	showToast: "Show toast",
	added: "Expense added",
	deleted: "Deleted Uber",
	undo: "Undo",
	skeleton: "Skeleton",
};

const STATIC_TOASTER = "gallery-static";

/**
 * The real Toaster, a second instance held inside the section instead of the
 * viewport corner, with one toast that stays until the page closes.
 */
function StaticToast({ message }: { message: string }) {
	useEffect(() => {
		const id = sonner.success(message, {
			toasterId: STATIC_TOASTER,
			duration: Number.POSITIVE_INFINITY,
			action: { label: S.undo, onClick: () => undefined },
		});
		return () => {
			sonner.dismiss(id);
		};
	}, [message]);
	return (
		<div className="relative h-20 max-w-90 [&_[data-sonner-toaster]]:absolute! [&_[data-sonner-toaster]]:inset-0! [&_[data-sonner-toaster]]:w-full!">
			<Toaster id={STATIC_TOASTER} position="top-left" />
		</div>
	);
}

export function FeedbackSection() {
	const toast = useToast();
	const empty = (
		<Empty
			action={
				<Button kind="secondary" size="sm">
					{S.addRecurring}
				</Button>
			}
			hint={S.emptyHint}
			icon={Inbox}
			title={S.emptyTitle}
		/>
	);
	return (
		<Spec id="feedback">
			<Pair
				desktop={
					<>
						<div className="w-80">{empty}</div>
						<div className="mt-4 flex flex-col gap-2">
							<Notice tone="info">{S.importing}</Notice>
							<Notice
								action={
									<Button kind="secondary" size="sm">
										{S.refresh}
									</Button>
								}
								tone="attention"
							>
								{S.rate}
							</Notice>
							<Notice
								action={
									<Button kind="secondary" size="sm">
										{S.retry}
									</Button>
								}
								tone="danger"
							>
								{S.server}
							</Notice>
						</div>
					</>
				}
				phone={
					<>
						{empty}
						<Notice tone="attention">{S.rate}</Notice>
					</>
				}
			/>
			<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
				<div>
					<Cap>{S.toastCap}</Cap>
					<StaticToast message={S.added} />
					<Button
						kind="secondary"
						onClick={() => toast.saved(S.added, { undo: () => undefined })}
					>
						{S.showToast}
					</Button>
				</div>
				<div>
					<Cap>{S.skeleton}</Cap>
					<SkeletonRows count={2} />
				</div>
			</div>
		</Spec>
	);
}
