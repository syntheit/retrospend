export type PaymentLinkResult = {
	url: string | null;
	webUrl: string | null;
	canDeepLink: boolean;
	instructions: string | null;
};

/**
 * Generates a deep link or payment URL for a given payment method type.
 * Always requires a user-initiated button click; never auto-opens.
 */
export function generatePaymentLink(
	type: string,
	identifier: string | null,
	amount: number,
	note: string,
	opts?: { currency?: string | null; network?: string | null },
): PaymentLinkResult {
	const { currency, network } = opts ?? {};

	if (!identifier) {
		return {
			url: null,
			webUrl: null,
			canDeepLink: false,
			instructions: null,
		};
	}

	const encodedNote = encodeURIComponent(note);
	const amtStr = amount.toFixed(2);

	switch (type.toLowerCase()) {
		case "venmo": {
			const handle = identifier.startsWith("@") ? identifier : `@${identifier}`;
			const raw = handle.slice(1);
			return {
				url: `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(handle)}&amount=${amtStr}&note=${encodedNote}`,
				webUrl: `https://venmo.com/${raw}?txn=pay&amount=${amtStr}&note=${encodedNote}`,
				canDeepLink: true,
				instructions: null,
			};
		}

		case "paypal": {
			const id = identifier.replace(/^@/, "");
			return {
				url: `https://paypal.me/${id}/${amtStr}`,
				webUrl: `https://paypal.me/${id}/${amtStr}`,
				canDeepLink: true,
				instructions: null,
			};
		}

		case "cash_app":
		case "cashapp": {
			const tag = identifier.startsWith("$") ? identifier : `$${identifier}`;
			return {
				url: `https://cash.app/${tag}/${amtStr}`,
				webUrl: `https://cash.app/${tag}/${amtStr}`,
				canDeepLink: true,
				instructions: null,
			};
		}

		case "zelle": {
			return {
				url: null,
				webUrl: null,
				canDeepLink: false,
				instructions: `Open your bank app → Send with Zelle → Recipient: ${identifier} → Amount: $${amtStr}`,
			};
		}

		case "crypto": {
			const net = (network ?? "").toLowerCase();
			const curr = (currency ?? "").toUpperCase();
			const isEvmNative =
				(net === "ethereum" && curr === "ETH") ||
				(net === "polygon" && (curr === "MATIC" || curr === "POL"));

			if (isEvmNative) {
				return {
					url: `ethereum:${identifier}`,
					webUrl: null,
					canDeepLink: true,
					instructions: `Send ${amtStr} ${curr} to ${identifier}`,
				};
			}
			return {
				url: null,
				webUrl: null,
				canDeepLink: false,
				instructions: `Send ${amtStr} ${curr || "tokens"} to address:\n${identifier}`,
			};
		}

		default: {
			return {
				url: null,
				webUrl: null,
				canDeepLink: false,
				instructions: `Send payment to: ${identifier}`,
			};
		}
	}
}

/**
 * Generates an auto-note for a settlement payment.
 */
export function autoPaymentNote(
	amount: number,
	currency: string,
	projectName?: string,
): string {
	const fmt = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: 2,
	});
	let note = `Retrospend: Settling ${fmt.format(amount)}`;
	if (projectName) note += `: ${projectName}`;
	return note;
}

export function maskIdentifier(identifier: string | null | undefined): string {
	if (!identifier) return "-";
	if (identifier.length <= 4) return identifier;
	return identifier.slice(0, 3) + "•••";
}

/**
 * Builds a payment link handling the no-amount case gracefully.
 * When amount is 0, produces simpler URLs without "0.00" baked in.
 */
export function buildPaymentLink(
	type: string,
	identifier: string | null,
	amount: number,
	note: string,
	opts?: { currency?: string | null; network?: string | null },
): PaymentLinkResult {
	if (!identifier) {
		return { url: null, webUrl: null, canDeepLink: false, instructions: null };
	}

	const t = type.toLowerCase();

	if (amount <= 0) {
		switch (t) {
			case "venmo": {
				const handle = identifier.startsWith("@")
					? identifier
					: `@${identifier}`;
				const encodedNote = encodeURIComponent(note);
				return {
					url: `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(handle)}&note=${encodedNote}`,
					webUrl: `https://venmo.com/${handle.slice(1)}?txn=pay&note=${encodedNote}`,
					canDeepLink: true,
					instructions: null,
				};
			}
			case "paypal": {
				const id = identifier.replace(/^@/, "");
				return {
					url: `https://paypal.me/${id}`,
					webUrl: `https://paypal.me/${id}`,
					canDeepLink: true,
					instructions: null,
				};
			}
			case "cashapp":
			case "cash_app": {
				const tag = identifier.startsWith("$") ? identifier : `$${identifier}`;
				return {
					url: `https://cash.app/${tag}`,
					webUrl: `https://cash.app/${tag}`,
					canDeepLink: true,
					instructions: null,
				};
			}
			case "zelle":
				return {
					url: null,
					webUrl: null,
					canDeepLink: false,
					instructions: `Open your bank app → Send with Zelle → Recipient: ${identifier}`,
				};
			case "crypto": {
				const curr = (opts?.currency ?? "").toUpperCase();
				const net = opts?.network ? ` on ${opts.network}` : "";
				return {
					url: null,
					webUrl: null,
					canDeepLink: false,
					instructions: `Send ${curr || "tokens"}${net} to:\n${identifier}`,
				};
			}
			default:
				return {
					url: null,
					webUrl: null,
					canDeepLink: false,
					instructions: `Send payment to: ${identifier}`,
				};
		}
	}

	return generatePaymentLink(type, identifier, amount, note, opts);
}
