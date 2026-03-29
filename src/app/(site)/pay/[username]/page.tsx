"use client";

import {
	Check,
	ChevronRight,
	Copy,
	ExternalLink,
	Loader2,
	RefreshCw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CurrencyPicker } from "~/components/currency-picker";
import { UserAvatar } from "~/components/ui/user-avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import type { CurrencyCode } from "~/lib/currencies";
import {
	PaymentMethodIcon,
	getPaymentMethodName,
} from "~/components/ui/payment-method-icon";
import { buildPaymentLink } from "~/lib/payment-links";
import {
	resolveMethodTypeId,
	getMethodType,
} from "~/lib/payment-method-registry";
import { cn } from "~/lib/utils";

import { api } from "~/trpc/react";

type PageParams = Promise<{ username: string }>;

function truncateCrypto(address: string): string {
	if (address.length <= 12) return address;
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CopyButton({
	text,
	label,
	variant = "icon",
}: {
	text: string;
	label?: string;
	variant?: "icon" | "button";
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		void navigator.clipboard.writeText(text);
		setCopied(true);
		toast.success("Copied!");
		setTimeout(() => setCopied(false), 2000);
	};

	if (variant === "button") {
		return (
			<Button className="gap-1.5" onClick={handleCopy} size="sm" variant="outline">
				{copied ? (
					<Check className="h-3.5 w-3.5 text-emerald-500" />
				) : (
					<Copy className="h-3.5 w-3.5" />
				)}
				{copied ? "Copied!" : (label ?? "Copy")}
			</Button>
		);
	}

	return (
		<Button
			aria-label={label ?? "Copy"}
			className="h-8 w-8 shrink-0 p-0"
			onClick={handleCopy}
			size="sm"
			variant="ghost"
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-emerald-500" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
		</Button>
	);
}

function PaySkeleton() {
	return (
		<div className="flex min-h-dvh items-center justify-center p-4">
			<div className="flex w-full max-w-[500px] flex-col gap-3">
				<Card>
					<CardContent className="space-y-4 p-5 sm:p-6">
						<div className="flex items-center gap-3">
							<Skeleton className="h-12 w-12 rounded-full" />
							<div className="space-y-2">
								<Skeleton className="h-6 w-40" />
								<Skeleton className="h-4 w-24" />
							</div>
						</div>
						<Skeleton className="h-10 w-full" />
						<div className="space-y-3">
							<Skeleton className="h-24 w-full rounded-lg" />
							<Skeleton className="h-24 w-full rounded-lg" />
						</div>
					</CardContent>
				</Card>
				<Skeleton className="h-24 w-full rounded-xl" />
			</div>
		</div>
	);
}

function PaymentMethodCard({
	method,
	amount,
	recipientName,
	isFirst,
}: {
	method: {
		id: string;
		type: string;
		label: string | null;
		identifier: string | null;
		currency: string | null;
		network: string | null;
		rank: number;
	};
	amount: number;
	recipientName: string;
	isFirst: boolean;
}) {
	const [linkState, setLinkState] = useState<"idle" | "opening">("idle");

	const resolvedType = resolveMethodTypeId(method.type, method.currency);
	const def = getMethodType(resolvedType);
	const displayName = getPaymentMethodName(method.type, method.label, method.currency);
	const isCrypto = def?.category === "crypto" || method.type.toLowerCase() === "crypto";
	const isCash = method.type.toLowerCase() === "cash";
	const networkDef = isCrypto && method.network
		? def?.networks?.find(
				(n) => n.id === method.network || n.shortName === method.network || n.name === method.network,
			)
		: null;
	const feeLevelColor: Record<string, string> = {
		low: "text-emerald-600 dark:text-emerald-400",
		medium: "text-amber-600 dark:text-amber-400",
		high: "text-rose-600 dark:text-rose-400",
	};

	const note = `Payment to ${recipientName} via Retrospend`;
	const link = useMemo(
		() =>
			buildPaymentLink(method.type, method.identifier, amount, note, {
				currency: method.currency,
				network: method.network,
			}),
		// biome-ignore lint/correctness/useExhaustiveDependencies: note is stable
		[method.type, method.identifier, amount, method.currency, method.network, note],
	);

	const handleOpenLink = () => {
		const url = link.webUrl ?? link.url;
		if (url) {
			const a = document.createElement("a");
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			a.click();
			setLinkState("opening");
			setTimeout(() => setLinkState("idle"), 3000);
		}
	};

	return (
		<Card>
			<CardContent className="space-y-2 px-3 py-2.5">
				<div className="flex items-center gap-2">
					<PaymentMethodIcon
						currency={method.currency}
						size="lg"
						typeId={method.type}
					/>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="font-semibold text-sm">
								{displayName}
							</span>
							{isFirst && (
								<Badge className="text-[10px]" variant="secondary">
									Preferred
								</Badge>
							)}
						</div>
						<div className="flex items-center gap-1 text-muted-foreground text-xs">
							{method.currency && (
								<span>{method.currency}</span>
							)}
							{isCrypto && networkDef && (
								<>
									<span>·</span>
									<span>{networkDef.shortName}</span>
									<span>·</span>
									<span className={feeLevelColor[networkDef.feeLevel] ?? ""}>
										{networkDef.feeLevel === "low"
											? "Low fee"
											: networkDef.feeLevel === "medium"
												? "Med fee"
												: "High fee"}
									</span>
								</>
							)}
						</div>
					</div>
				</div>

				{method.identifier && (
					<div className="rounded-md bg-muted/50 px-3 py-2">
						<p className="break-all font-mono text-sm">
							{method.identifier}
						</p>
					</div>
				)}

				{isCrypto && method.network && !networkDef && (
					<p className="text-muted-foreground text-xs">
						Make sure you&apos;re sending on {method.network}
					</p>
				)}

				{isCash && (
					<p className="text-muted-foreground text-sm">
						Accepts cash{method.currency ? ` in ${method.currency}` : ""}
					</p>
				)}

				<div className="flex flex-wrap gap-2">
					{link.canDeepLink && (link.url ?? link.webUrl) && (
						<Button className="gap-1.5" onClick={handleOpenLink} size="sm">
							{linkState === "opening" ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									Opening {displayName}...
								</>
							) : (
								<>
									<ExternalLink className="h-3.5 w-3.5" />
									Open {displayName}
								</>
							)}
						</Button>
					)}

					{!link.canDeepLink && link.instructions && !isCash && (
						<p className="w-full text-muted-foreground text-xs">
							{link.instructions}
						</p>
					)}

					{method.identifier && !isCash && (
						<CopyButton
							label={
								isCrypto
									? "Copy address"
									: method.type === "zelle"
										? "Copy email"
										: `Copy ${displayName}`
							}
							text={method.identifier}
							variant="button"
						/>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PayPage({ params }: { params: PageParams }) {
	const { username } = use(params);
	const router = useRouter();
	const searchParams = useSearchParams();

	const urlAmount = searchParams.get("amount");
	const urlCurrency = searchParams.get("currency");
	const isDonate = searchParams.has("donate");
	const isLockedByUrl = !!urlAmount && !!urlCurrency;

	const [amount, setAmount] = useState(urlAmount ?? "");
	const [currency, setCurrency] = useState<CurrencyCode>(
		(urlCurrency as CurrencyCode) ?? "USD",
	);

	const { data, isLoading, isError, error, refetch } =
		api.profile.publicProfile.useQuery({ username }, { retry: false });

	useEffect(() => {
		if (data && "redirect" in data && data.redirect) {
			const params = new URLSearchParams();
			if (urlAmount) params.set("amount", urlAmount);
			if (urlCurrency) params.set("currency", urlCurrency);
			if (isDonate) params.set("donate", "");
			const qs = params.toString();
			router.replace(`/pay/${data.redirect}${qs ? `?${qs}` : ""}`);
		}
	}, [data, router, urlAmount, urlCurrency, isDonate]);

	if (isLoading) return <PaySkeleton />;

	if (data && "redirect" in data) return <PaySkeleton />;

	if (isError || !data) {
		const isNotFound =
			(error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus ===
			404;

		return (
			<div className="flex min-h-dvh items-center justify-center p-4">
				<Card className="w-full max-w-[500px]">
					<CardContent className="space-y-4 p-5 text-center sm:p-6">
						<h1 className="font-bold text-xl">
							{isNotFound ? "This profile doesn't exist" : "Something went wrong"}
						</h1>
						<p className="text-muted-foreground text-sm">
							{isNotFound
								? "Check the username and try again."
								: "We couldn't load this profile. Please try again."}
						</p>
						<div className="flex justify-center gap-3">
							{!isNotFound && (
								<Button onClick={() => void refetch()} variant="outline">
									<RefreshCw className="mr-1.5 h-4 w-4" />
									Try again
								</Button>
							)}
							<Button asChild variant={isNotFound ? "default" : "outline"}>
								<Link href="/">Go to Retrospend</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	const parsedAmount = parseFloat(amount) || 0;
	const firstName = data.displayName.split(" ")[0] ?? data.displayName;

	return (
		<div className="flex min-h-dvh items-center justify-center p-4">
			<div className="flex w-full max-w-[500px] flex-col gap-3">
				<Card>
					<CardContent className="p-5 sm:p-6">
						{/* Header */}
						<div className="flex items-center gap-3">
							<UserAvatar
								avatarUrl={data.avatar}
								name={data.displayName}
								size="md"
							/>
							<div className="min-w-0">
								<h1 className="font-bold text-xl">{isDonate ? `Donate to ${data.displayName}` : `Pay ${data.displayName}`}</h1>
								<Link
									className="text-muted-foreground text-sm hover:text-primary hover:underline"
									href={`/u/${data.username}`}
								>
									@{data.username} · View profile
								</Link>
							</div>
						</div>

						{/* Divider */}
						<div className="my-4 border-t border-border/50" />

						{/* Amount field */}
						<div className="space-y-2">
							<Label>Amount (optional)</Label>
							<div
								className={cn(
									"flex h-9 w-full overflow-hidden rounded-md border border-input shadow-xs",
									"transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
									"dark:bg-input/30",
									isLockedByUrl && "opacity-50",
								)}
							>
								<CurrencyPicker
									onValueChange={setCurrency}
									triggerClassName={cn(
										"h-full rounded-none border-r border-input px-2 shrink-0 focus-visible:ring-0",
										isLockedByUrl && "pointer-events-none",
									)}
									triggerDisplay="flag+code"
									triggerVariant="ghost"
									value={currency}
								/>
								<Input
									className="h-full flex-1 border-0 bg-transparent px-2 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
									disabled={isLockedByUrl}
									inputMode="decimal"
									onChange={(e) => setAmount(e.target.value)}
									placeholder="0.00"
									type="number"
									value={amount}
								/>
							</div>
							{isLockedByUrl && (
								<p className="text-muted-foreground text-xs">
									Amount set by sender
								</p>
							)}
						</div>

						{/* Divider */}
						<div className="my-4 border-t border-border/50" />

						{/* Payment methods */}
						{data.publicMethods.length > 0 ? (
							<div className="space-y-3">
								<h2 className="font-semibold text-muted-foreground text-sm">
									{isDonate ? "Choose a donation method" : "Choose a payment method"}
								</h2>
								{data.publicMethods.map((method, i) => (
									<PaymentMethodCard
										amount={parsedAmount}
										isFirst={i === 0}
										key={method.id}
										method={method}
										recipientName={data.displayName}
									/>
								))}
							</div>
						) : (
							<div className="space-y-1 py-4 text-center">
								<p className="text-muted-foreground text-sm">
									{firstName} hasn&apos;t added any public payment methods yet.
								</p>
								<p className="text-muted-foreground text-xs">
									Contact them directly to arrange payment.
								</p>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Branded Footer */}
				<Card className="bg-muted/30">
					<CardContent className="flex flex-col items-center gap-2 p-4 text-center">
						<div className="flex items-center gap-2">
							<Image
								alt="Retrospend"
								className="rounded-sm"
								height={20}
								src="/favicon-32x32.png"
								width={20}
							/>
							<span className="font-bold text-sm tracking-tight">
								Retrospend
							</span>
						</div>
						<p className="text-muted-foreground text-xs">
							Split and track expenses with anyone
						</p>
						<Button asChild className="mt-1 gap-1" size="sm">
							<Link href="/signup">
								Get started free
								<ChevronRight className="h-3.5 w-3.5" />
							</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
