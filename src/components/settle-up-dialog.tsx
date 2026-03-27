"use client";

import {
	ArrowRight,
	CheckCircle2,
	Copy,
	ExternalLink,
	Info,
	Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useSession } from "~/hooks/use-session";
import {
	PaymentMethodIcon,
	getPaymentMethodName,
} from "~/components/ui/payment-method-icon";
import {
	autoPaymentNote,
	generatePaymentLink,
} from "~/lib/payment-links";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

type ParticipantType = "user" | "guest" | "shadow";

type SelectedMethod = {
	type: string;
	label: string | null;
	theirIdentifier: string | null;
	link: ReturnType<typeof generatePaymentLink>;
};

type SuccessSummary = {
	amount: number;
	currency: string;
	remainingBalance: number | null;
	direction: "you_owe_them" | "they_owe_you";
	requiresPayeeConfirmation: boolean;
};

export interface SettleUpDialogProps {
	open: boolean;
	onClose: () => void;
	participantType: ParticipantType;
	participantId: string;
	personName: string;
	personAvatarUrl?: string | null;
}

export function SettleUpDialog({
	open,
	onClose,
	participantType,
	participantId,
	personName,
	personAvatarUrl,
}: SettleUpDialogProps) {
	const { formatCurrency } = useCurrencyFormatter();
	const utils = api.useUtils();
	const session = useSession();
	const myName = session.data?.user?.name ?? "You";
	const myImage = session.data?.user?.image ?? null;

	const { data: plan, isLoading: planLoading } = api.settlement.plan.useQuery(
		{ participantType, participantId },
		{ enabled: open },
	);

	const { data: methodMatch, isLoading: matchLoading } =
		api.paymentMethod.match.useQuery(
			{ participantType, participantId },
			{ enabled: open && participantType === "user" },
		);

	const activePlans = plan?.filter((p) => p.direction !== "settled") ?? [];
	const [selectedCurrencyIdx, setSelectedCurrencyIdx] = useState(0);
	const firstActivePlan = activePlans[selectedCurrencyIdx];

	const [amount, setAmount] = useState("");
	const [note, setNote] = useState("");
	const [showNote, setShowNote] = useState(false);
	const [selectedMethod, setSelectedMethod] = useState<SelectedMethod | null>(
		null,
	);
	const [paymentStep, setPaymentStep] = useState<"idle" | "confirm" | "success">("idle");
	const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			setAmount("");
			setNote("");
			setShowNote(false);
			setSelectedMethod(null);
			setPaymentStep("idle");
			setSuccessSummary(null);
			setSelectedCurrencyIdx(0);
		}
	}, [open]);

	// Pre-fill amount when currency tab changes (Issue 6 fix)
	useEffect(() => {
		if (firstActivePlan) {
			setAmount(String(firstActivePlan.suggestedAmount));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedCurrencyIdx, firstActivePlan?.currency]);

	const defaultAmount = firstActivePlan
		? String(firstActivePlan.suggestedAmount)
		: "";
	const currency = firstActivePlan?.currency ?? "USD";

	const parsedAmount = parseFloat(amount);
	const parsedDefault = parseFloat(defaultAmount);
	const isPartial =
		!Number.isNaN(parsedAmount) &&
		!Number.isNaN(parsedDefault) &&
		parsedAmount < parsedDefault;
	const isOverpayment =
		!Number.isNaN(parsedAmount) &&
		!Number.isNaN(parsedDefault) &&
		parsedAmount > parsedDefault &&
		parsedDefault > 0;

	const compatible = methodMatch?.compatible ?? [];

	const createSettlement = api.settlement.create.useMutation({
		onSuccess: (result, variables) => {
			if (result.warning) {
				toast.warning(result.warning);
			}
			void utils.people.detail.invalidate();
			void utils.people.detailCursor.invalidate();
			void utils.settlement.plan.invalidate();
			void utils.settlement.history.invalidate();
			void utils.people.list.invalidate();

			// Compute remaining balance for success view
			const settledAmount = variables.amount;
			const planEntry = firstActivePlan;
			let remaining: number | null = null;
			if (planEntry && settledAmount < planEntry.balance) {
				remaining = planEntry.balance - settledAmount;
			}

			setSuccessSummary({
				amount: settledAmount,
				currency: variables.currency,
				remainingBalance: remaining,
				direction: (planEntry?.direction ?? "they_owe_you") as "you_owe_them" | "they_owe_you",
				requiresPayeeConfirmation: result.requiresPayeeConfirmation,
			});
			setPaymentStep("success");
		},
		onError: (e) => toast.error(e.message),
	});

	const handleConfirm = () => {
		const parsed = parseFloat(amount);
		if (Number.isNaN(parsed) || parsed <= 0) {
			toast.error("Enter a valid amount");
			return;
		}
		createSettlement.mutate({
			toParticipant: { participantType, participantId },
			amount: parsed,
			currency,
			note: note.trim() || null,
			paymentMethod: selectedMethod?.type ?? null,
		});
	};

	const handleMethodAction = (method: (typeof compatible)[number]) => {
		const parsed = parseFloat(amount);
		if (Number.isNaN(parsed) || parsed <= 0) {
			toast.error("Enter a valid amount first");
			return;
		}
		const noteToUse = note.trim() || autoPaymentNote(parsed, currency);
		if (!note.trim()) {
			setNote(noteToUse);
			setShowNote(true);
		}

		const link = generatePaymentLink(
			method.type,
			method.theirIdentifier,
			parsed,
			noteToUse,
		);

		const sel: SelectedMethod = {
			type: method.type,
			label: method.label,
			theirIdentifier: method.theirIdentifier,
			link,
		};
		setSelectedMethod(sel);

		if (link.canDeepLink && link.url) {
			window.open(link.url, "_blank");
		}
		setPaymentStep("confirm");
	};

	// -- Success state --
	if (paymentStep === "success" && successSummary) {
		const isFullySettled = successSummary.remainingBalance === null || successSummary.remainingBalance <= 0;
		const wasReceiving = successSummary.direction === "they_owe_you";
		const needsConfirmation = successSummary.requiresPayeeConfirmation;

		return (
			<ResponsiveDialog onOpenChange={(o) => !o && onClose()} open={open}>
				<ResponsiveDialogContent className="sm:max-w-md">
					<div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
						<div className="settle-success-icon flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
							<CheckCircle2 className="h-9 w-9" />
						</div>

						<div className="space-y-1">
							<h2 className="font-semibold text-xl">
								Settlement recorded
							</h2>
							<p className="text-muted-foreground text-sm">
								{wasReceiving
									? `You recorded a ${formatCurrency(successSummary.amount, successSummary.currency)} payment from ${personName}`
									: `You recorded a ${formatCurrency(successSummary.amount, successSummary.currency)} payment to ${personName}`}
							</p>
						</div>

						{needsConfirmation && (
							<div className="w-full rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
								<p className="text-muted-foreground">
									{personName} can confirm or reject this settlement. It will auto-confirm in 7 days.
								</p>
							</div>
						)}

						<div className="w-full rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
							{isFullySettled ? (
								<p className="font-medium text-emerald-600 dark:text-emerald-400">
									You&apos;re all settled up with {personName}!
								</p>
							) : (
								<div className="flex justify-between">
									<span className="text-muted-foreground">Remaining balance</span>
									<span className="font-semibold">
										{formatCurrency(successSummary.remainingBalance!, successSummary.currency)}
									</span>
								</div>
							)}
						</div>

						<Button className="w-full" onClick={onClose}>
							Done
						</Button>
					</div>
				</ResponsiveDialogContent>
			</ResponsiveDialog>
		);
	}

	// -- Confirmation step (payment method selected) --
	if (paymentStep === "confirm" && selectedMethod) {
		const { link } = selectedMethod;
		const displayName = getPaymentMethodName(
			selectedMethod.type,
			selectedMethod.label,
		);

		return (
			<ResponsiveDialog onOpenChange={(o) => !o && onClose()} open={open}>
				<ResponsiveDialogContent className="sm:max-w-md">
					<ResponsiveDialogHeader>
						<ResponsiveDialogTitle>Settle Up with {personName}</ResponsiveDialogTitle>
						<ResponsiveDialogDescription>Did you send the payment?</ResponsiveDialogDescription>
					</ResponsiveDialogHeader>

					<div className="space-y-4 py-2">
						<div className="rounded-lg border border-border bg-muted/30 p-4">
							<div className="flex items-center gap-2 font-medium text-sm">
								<PaymentMethodIcon size="sm" typeId={selectedMethod.type} />
								{link.canDeepLink
									? `Payment link opened via ${displayName}`
									: `Pay via ${displayName}`}
							</div>

							{link.instructions && (
								<p className="mt-2 whitespace-pre-wrap text-muted-foreground text-sm">
									{link.instructions}
								</p>
							)}

							<div className="mt-3 flex flex-wrap gap-2">
								{selectedMethod.theirIdentifier && (
									<Button
										className="h-7 gap-1 px-2 text-xs"
										onClick={() => {
											void navigator.clipboard.writeText(
												selectedMethod.theirIdentifier!,
											);
											toast.success("Copied to clipboard");
										}}
										size="sm"
										variant="outline"
									>
										<Copy className="h-3 w-3" />
										Copy identifier
									</Button>
								)}
								{link.webUrl && link.url !== link.webUrl && (
									<Button
										asChild
										className="h-7 gap-1 px-2 text-xs"
										size="sm"
										variant="outline"
									>
										<a
											href={link.webUrl}
											rel="noopener noreferrer"
											target="_blank"
										>
											<ExternalLink className="h-3 w-3" />
											Open in browser
										</a>
									</Button>
								)}
								{link.canDeepLink && link.url && link.url === link.webUrl && (
									<Button
										asChild
										className="h-7 gap-1 px-2 text-xs"
										size="sm"
										variant="outline"
									>
										<a
											href={link.url}
											rel="noopener noreferrer"
											target="_blank"
										>
											<ExternalLink className="h-3 w-3" />
											Open {displayName}
										</a>
									</Button>
								)}
							</div>
						</div>

						<p className="text-center font-medium text-sm">
							Did you complete the payment?
						</p>
					</div>

					<div className="flex flex-col gap-2">
						<Button
							disabled={createSettlement.isPending}
							onClick={handleConfirm}
						>
							<CheckCircle2 className="h-4 w-4" />
							{createSettlement.isPending ? "Saving..." : "Yes, Record Payment"}
						</Button>
						<Button onClick={() => setPaymentStep("idle")} variant="ghost">
							Back
						</Button>
					</div>
				</ResponsiveDialogContent>
			</ResponsiveDialog>
		);
	}

	// -- Normal form step --
	return (
		<ResponsiveDialog onOpenChange={(o) => !o && onClose()} open={open}>
			<ResponsiveDialogContent className="sm:max-w-md">
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle>Settle Up</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						Record a payment to zero out your balance.
					</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				{planLoading ? (
					<div className="space-y-3 py-2">
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-9 w-full" />
					</div>
				) : plan && activePlans.length > 0 && firstActivePlan ? (
					<div className="space-y-5 py-1">
						{/* Visual direction indicator */}
						{(() => {
							const isReceiving = firstActivePlan.direction === "they_owe_you";
							const [leftName, leftImg, rightName, rightImg] = isReceiving
								? [personName, personAvatarUrl, myName, myImage]
								: [myName, myImage, personName, personAvatarUrl];

							return (
								<div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-4">
									<div className="flex w-full items-center justify-between gap-2">
										{/* Debtor */}
										<div className="flex flex-col items-center gap-1.5">
											<UserAvatar
												avatarUrl={leftImg}
												name={leftName}
												size="sm"
											/>
											<span className="max-w-[72px] truncate text-center text-muted-foreground text-xs">
												{isReceiving ? personName : "You"}
											</span>
										</div>

										{/* Arrow + amount */}
										<div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
											<span
												className={cn(
													"font-semibold text-base",
													isReceiving
														? "text-emerald-600 dark:text-emerald-400"
														: "text-rose-600 dark:text-rose-400",
												)}
											>
												{formatCurrency(firstActivePlan.balance, currency)}
											</span>
											<div className="flex w-full items-center gap-1">
												<div className="h-px flex-1 bg-border" />
												<ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
												<div className="h-px flex-1 bg-border" />
											</div>
											<span className="text-muted-foreground text-xs">
												{isReceiving ? "they owe you" : "you owe them"}
											</span>
										</div>

										{/* Creditor */}
										<div className="flex flex-col items-center gap-1.5">
											<UserAvatar
												avatarUrl={rightImg}
												name={rightName}
												size="sm"
											/>
											<span className="max-w-[72px] truncate text-center text-muted-foreground text-xs">
												{isReceiving ? "You" : personName}
											</span>
										</div>
									</div>

								</div>
							);
						})()}

						{/* Amount */}
						<div className="space-y-2">
							{activePlans.length > 1 && (
								<div className="flex gap-1.5">
									{activePlans.map((p, idx) => (
										<button
											key={p.currency}
											type="button"
											className={cn(
												"rounded-full border px-3 py-1 text-xs font-medium transition-colors",
												idx === selectedCurrencyIdx
													? "border-primary bg-primary/10 text-primary"
													: "border-border text-muted-foreground hover:bg-muted/50",
											)}
											onClick={() => {
												setSelectedCurrencyIdx(idx);
											}}
										>
											{formatCurrency(p.balance, p.currency)}
										</button>
									))}
								</div>
							)}
							<div className="flex items-center justify-between">
								<Label htmlFor="settle-amount">Amount ({currency})</Label>
								{isPartial && (
									<Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
										Partial settlement
									</Badge>
								)}
							</div>
							<Input
								aria-describedby={isOverpayment ? "overpayment-warning" : undefined}
								id="settle-amount"
								inputMode="decimal"
								onChange={(e) => setAmount(e.target.value)}
								type="number"
								value={amount}
							/>
							{/* Issue 5: Inline overpayment warning */}
							{isOverpayment && (
								<p className="text-amber-600 text-xs dark:text-amber-400" id="overpayment-warning">
									Exceeds the current balance by{" "}
									{formatCurrency(parsedAmount - parsedDefault, currency)}.
									The excess will be recorded as an overpayment.
								</p>
							)}
							{defaultAmount && (
								<button
									className={cn(
										"rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs transition-colors hover:bg-muted",
										amount === defaultAmount && "border-primary/40 bg-primary/5 text-primary",
									)}
									onClick={() => setAmount(defaultAmount)}
									type="button"
								>
									Full amount — {formatCurrency(parseFloat(defaultAmount), currency)}
								</button>
							)}
						</div>

						{/* Payment methods */}
						{participantType === "user" && (
							<div className="space-y-2">
								<Label>Pay via (optional)</Label>
								{matchLoading ? (
									<Skeleton className="h-12 w-full" />
								) : compatible.length > 0 ? (
									<div className="space-y-1.5">
										{compatible.map((method, idx) => {
											const name = getPaymentMethodName(method.type, method.label);
											const isDeepLink = generatePaymentLink(
												method.type,
												method.theirIdentifier,
												0,
												"",
											).canDeepLink;
											const isSelected = selectedMethod?.type === method.type;
											return (
												<div
													className={cn(
														"flex items-center justify-between rounded-lg border px-3 py-2 transition-colors",
														isSelected
															? "border-primary bg-primary/5"
															: "border-border hover:bg-muted/50",
													)}
													key={`${method.type}-${idx}`}
												>
													<div className="flex min-w-0 items-center gap-2">
														<PaymentMethodIcon size="sm" typeId={method.type} />
														<div className="min-w-0">
															<div className="flex flex-wrap items-center gap-1.5">
																<span className="font-medium text-sm">
																	{name}
																</span>
																{idx === 0 && (
																	<Badge
																		className="h-4 px-1 py-0 text-[10px]"
																		variant="secondary"
																	>
																		Best Match
																	</Badge>
																)}
															</div>
															{method.theirIdentifier && (
																<span className="block truncate text-muted-foreground text-xs">
																	{method.theirIdentifier}
																</span>
															)}
														</div>
													</div>
													<Button
														className="ml-2 h-7 shrink-0 gap-1 px-2 text-xs"
														onClick={() => handleMethodAction(method)}
														size="sm"
														variant={isSelected ? "default" : "outline"}
													>
														{isDeepLink ? (
															<>
																<ExternalLink className="h-3 w-3" />
																Open {name}
															</>
														) : (
															<>
																<Copy className="h-3 w-3" />
																Copy info
															</>
														)}
													</Button>
												</div>
											);
										})}
									</div>
								) : (
									<div className="flex items-center gap-2 text-muted-foreground text-xs">
										<Info className="h-3.5 w-3.5" />
										No shared payment methods
									</div>
								)}
							</div>
						)}

						{/* Note — collapsible */}
						{showNote ? (
							<div className="space-y-1.5">
								<Label htmlFor="settle-note">Note</Label>
								<Textarea
									className="resize-none"
									id="settle-note"
									onChange={(e) => setNote(e.target.value)}
									placeholder={autoPaymentNote(
										parseFloat(amount) || 0,
										currency,
									)}
									rows={2}
									value={note}
								/>
							</div>
						) : (
							<button
								className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
								onClick={() => setShowNote(true)}
								type="button"
							>
								<Plus className="h-3 w-3" />
								Add note
							</button>
						)}
					</div>
				) : (
					<div className="py-4 text-center text-muted-foreground text-sm">
						No outstanding balance with {personName}.
					</div>
				)}

				{/* Issue 4: Primary action first, Cancel below */}
				<div className="flex flex-col gap-2 pt-2">
					<Button
						className="w-full gap-2"
						disabled={
							planLoading || !firstActivePlan || createSettlement.isPending
						}
						onClick={handleConfirm}
					>
						<CheckCircle2 className="h-4 w-4" />
						{createSettlement.isPending ? "Saving..." : "Record Payment"}
					</Button>
					{participantType === "user" && firstActivePlan && (
						<p className="text-center text-muted-foreground text-xs">
							Your balance will update immediately. {personName} has 7 days to confirm.
						</p>
					)}
					<Button className="w-full" onClick={onClose} variant="ghost">
						Cancel
					</Button>
				</div>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
