"use client";

import {
	Check,
	ClipboardCopy,
	Copy,
	Edit2,
	Trash2,
	UserMinus,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import { CategoryChip } from "~/components/category-chip";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
} from "~/components/ui/drawer";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useIsMobile } from "~/hooks/use-mobile";
import type { NormalizedExpense } from "~/lib/normalize";
import { formatExpenseDate } from "~/lib/format";
import { cn } from "~/lib/utils";

type Expense = NormalizedExpense;

export interface ExpenseActionsSheetHandlers {
	/** Accept the caller's own pending verification. Shared only. */
	onAccept: (sharedTxId: string) => void;
	/** Open the reject flow for the caller's pending verification. Shared only. */
	onReject: (sharedTxId: string) => void;
	/** Remove the caller's own split from a shared expense. Shared only. */
	onRemoveSelf: (sharedTxId: string) => void;
	/** Open the editor. Personal takes the expense id; shared takes the transaction id. */
	onEdit: (expense: Expense) => void;
	/** Delete. Personal takes the expense id; shared takes the transaction id. */
	onDelete: (expense: Expense) => void;
	/** Duplicate a personal expense. */
	onDuplicate: (id: string) => void;
	/** Copy the expense as plain text. */
	onCopy: (expense: Expense) => void;
}

interface ExpenseActionsSheetProps extends ExpenseActionsSheetHandlers {
	/** The expense to show details/actions for, or null when closed. */
	expense: Expense | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * A tap-accessible detail + actions surface for a single expense.
 *
 * On mobile it renders as a bottom Drawer; on desktop as a centered Dialog. It
 * always shows the expense details (doubling as the read-only view for users
 * who cannot edit) followed by only the actions the caller is actually allowed
 * to perform — the same gating the desktop context menu enforces, so an
 * impossible action never appears here.
 */
export function ExpenseActionsSheet({
	expense,
	open,
	onOpenChange,
	onAccept,
	onReject,
	onRemoveSelf,
	onEdit,
	onDelete,
	onDuplicate,
	onCopy,
}: ExpenseActionsSheetProps) {
	const t = useTranslations("transactions");
	const isMobile = useIsMobile();

	const title = expense?.title?.trim() || t("untitled");

	const body = expense ? (
		<ExpenseActionsBody
			expense={expense}
			onAccept={onAccept}
			onReject={onReject}
			onRemoveSelf={onRemoveSelf}
			onEdit={onEdit}
			onDelete={onDelete}
			onDuplicate={onDuplicate}
			onCopy={onCopy}
			onClose={() => onOpenChange(false)}
		/>
	) : null;

	if (isMobile) {
		return (
			<Drawer onOpenChange={onOpenChange} open={open}>
				<DrawerContent
					className="max-h-[85dvh]"
					// Keep content clear of the home indicator / gesture bar on PWAs.
					style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
				>
					<DrawerHeader className="pb-2 text-left">
						<DrawerTitle className="truncate text-base">{title}</DrawerTitle>
					</DrawerHeader>
					<div className="overflow-y-auto overscroll-contain px-4 pb-4">
						{body}
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="truncate">{title}</DialogTitle>
				</DialogHeader>
				{body}
			</DialogContent>
		</Dialog>
	);
}

function ExpenseActionsBody({
	expense,
	onAccept,
	onReject,
	onRemoveSelf,
	onEdit,
	onDelete,
	onDuplicate,
	onCopy,
	onClose,
}: ExpenseActionsSheetHandlers & {
	expense: Expense;
	onClose: () => void;
}) {
	const t = useTranslations("transactions");
	const { formatCurrency } = useCurrencyFormatter();

	const isShared = expense.source === "shared";
	const shared = expense.sharedContext;

	// Wrap a handler so every action also dismisses the surface.
	const run = (fn: () => void) => () => {
		fn();
		onClose();
	};

	// --- Gating (mirrors the desktop context menu exactly) ---
	const sharedTxId = shared?.transactionId;
	const isLocked = !!shared?.isLocked;
	const canAcceptReject =
		isShared && shared?.myVerificationStatus === "PENDING" && !isLocked;
	// Creators delete rather than remove-self: leaving would hide the expense
	// from their own view while it stays live for everyone else.
	const canRemoveSelf = isShared && !isLocked && !shared?.isCreator;
	const canEdit = isShared ? !!shared?.canEdit : true;
	const canDelete = isShared ? !!shared?.canDelete : true;

	return (
		<div className="flex flex-col gap-4">
			{/* Details — also the read-only view for users who cannot edit. */}
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
				<DetailRow label={t("detailAmount")}>
					<span className="font-semibold tabular-nums">
						{formatCurrency(expense.amount, expense.currency)}
					</span>
				</DetailRow>

				{isShared && shared && (
					<DetailRow label={t("detailTotal")}>
						<span className="tabular-nums">
							{formatCurrency(shared.totalAmount, expense.currency)}
						</span>
					</DetailRow>
				)}

				{isShared && shared && (
					<DetailRow label={t("detailPaidBy")}>
						<span className="flex items-center gap-1.5">
							<UserAvatar
								avatarUrl={shared.paidByAvatarUrl}
								name={shared.iPayedThis ? t("you") : shared.paidByName}
								size="xs"
							/>
							{shared.iPayedThis ? t("you") : shared.paidByName}
						</span>
					</DetailRow>
				)}

				<DetailRow label={t("detailDate")}>
					<span>{formatExpenseDate(new Date(expense.date))}</span>
				</DetailRow>

				<DetailRow label={t("detailCategory")}>
					{expense.category ? (
						<CategoryChip
							color={expense.category.color}
							icon={expense.category.icon}
							name={expense.category.name}
						/>
					) : (
						<span className="text-muted-foreground">{t("detailNone")}</span>
					)}
				</DetailRow>

				{isShared && shared?.projectName && (
					<DetailRow label={t("detailProject")}>
						<span>{shared.projectName}</span>
					</DetailRow>
				)}

				{expense.description?.trim() && (
					<DetailRow label={t("detailDescription")}>
						<span className="whitespace-pre-wrap break-words">
							{expense.description.trim()}
						</span>
					</DetailRow>
				)}

				{isShared && shared && (
					<DetailRow label={t("detailStatus")}>
						<VerificationBadge status={shared.myVerificationStatus} />
					</DetailRow>
				)}
			</dl>

			{/* Split breakdown */}
			{isShared &&
				shared?.splitParticipants &&
				shared.splitParticipants.length > 0 && (
					<div className="flex flex-col gap-2">
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							{t("detailSplitBreakdown")}
						</p>
						<ul className="flex flex-col gap-1.5">
							{shared.splitParticipants.map((p) => (
								<li
									key={`${p.participantType}:${p.participantId}`}
									className="flex items-center justify-between gap-2 text-sm"
								>
									<span className="flex min-w-0 items-center gap-2">
										<UserAvatar
											avatarUrl={p.avatarUrl}
											name={p.name}
											size="xs"
										/>
										<span className="truncate">{p.name}</span>
									</span>
									<span className="tabular-nums text-muted-foreground">
										{formatCurrency(p.shareAmount, expense.currency)}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}

			{/* Actions — only the ones the user may actually perform. */}
			<div className="flex flex-col gap-2 border-t pt-3">
				{canAcceptReject && sharedTxId && (
					<div className="grid grid-cols-2 gap-2">
						<ActionButton
							icon={Check}
							iconClassName="text-emerald-500"
							label={t("accept")}
							onClick={run(() => onAccept(sharedTxId))}
						/>
						<ActionButton
							icon={X}
							iconClassName="text-rose-500"
							label={t("reject")}
							onClick={run(() => onReject(sharedTxId))}
						/>
					</div>
				)}

				{canEdit && (
					<ActionButton
						icon={Edit2}
						label={t("editExpense")}
						onClick={run(() => onEdit(expense))}
					/>
				)}

				{!isShared && (
					<ActionButton
						icon={Copy}
						label={t("duplicateExpense")}
						onClick={run(() => onDuplicate(expense.id))}
					/>
				)}

				<ActionButton
					icon={ClipboardCopy}
					label={t("copyAsText")}
					onClick={run(() => onCopy(expense))}
				/>

				{canRemoveSelf && sharedTxId && (
					<ActionButton
						icon={UserMinus}
						label={t("removeMe")}
						onClick={run(() => onRemoveSelf(sharedTxId))}
					/>
				)}

				{canDelete && (
					<ActionButton
						icon={Trash2}
						label={t("deleteExpense")}
						onClick={run(() => onDelete(expense))}
						variant="destructive"
					/>
				)}
			</div>
		</div>
	);
}

function DetailRow({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="flex min-w-0 items-center justify-end text-right">
				{children}
			</dd>
		</>
	);
}

function VerificationBadge({
	status,
}: {
	status?: "PENDING" | "ACCEPTED" | "AUTO_ACCEPTED" | "REJECTED";
}) {
	const t = useTranslations("transactions");
	switch (status) {
		case "ACCEPTED":
		case "AUTO_ACCEPTED":
			return (
				<Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" variant="outline">
					{t("statusAccepted")}
				</Badge>
			);
		case "REJECTED":
			return (
				<Badge className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400" variant="outline">
					{t("statusRejected")}
				</Badge>
			);
		case "PENDING":
			return (
				<Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" variant="outline">
					{t("statusPending")}
				</Badge>
			);
		default:
			return null;
	}
}

function ActionButton({
	icon: Icon,
	iconClassName,
	label,
	onClick,
	variant = "outline",
}: {
	icon: ComponentType<{ className?: string }>;
	iconClassName?: string;
	label: string;
	onClick: () => void;
	variant?: "outline" | "destructive";
}) {
	return (
		<Button
			// Large touch target for PWA / mobile ergonomics.
			className="h-11 w-full justify-start gap-2.5"
			onClick={onClick}
			variant={variant}
		>
			<Icon className={cn("h-4 w-4", iconClassName)} />
			{label}
		</Button>
	);
}
