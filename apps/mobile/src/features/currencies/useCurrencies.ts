import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useToast } from "@/ui/Toast";
import {
	type Conversion,
	type ConvertDirection,
	type CurrencyRow,
	fetchRateTable,
	pinChange,
	RATE_TABLE_CACHE,
} from "./source";

/** The rate table, cached like every screen's read so it opens offline. */
export function useRateTable() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchRateTable(api) : null), [api]);
	return useCachedRead(RATE_TABLE_CACHE, fetch);
}

/**
 * The currencies starred on the Currencies screen, in the table's order. The
 * currency picker lists them first, so the pins mean the same everywhere.
 * The picker only reads what this run or the phone already has: the
 * Currencies screen is what asks the server. Empty until the table has been
 * read once.
 */
export function usePinnedCurrencies(): string[] {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchRateTable(api) : null), [api]);
	const { state } = useCachedRead(RATE_TABLE_CACHE, fetch, undefined, {
		passive: true,
	});
	return useMemo(
		() =>
			state.status === "ready"
				? state.data.rows.filter((r) => r.favorite).map((r) => r.code)
				: [],
		[state],
	);
}

/**
 * A conversion the server computes: the typed amount (minor units from the
 * shared parser) goes up, a Money per rate type comes back. Waits a moment
 * so typing does not send a request per key; a stale answer never replaces
 * a newer one.
 */
export function useConvert(
	code: string | null,
	minor: number | null,
	direction: ConvertDirection,
) {
	const { api } = useSession();
	const [result, setResult] = useState<Conversion | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (!api || !code || minor === null) {
			setResult(null);
			return;
		}
		let live = true;
		const timer = setTimeout(() => {
			api.currencies
				.convert({ currency: code, amount: minor, direction })
				.then((r) => {
					if (!live) return;
					setResult(r);
					setFailed(false);
				})
				.catch(() => {
					if (live) setFailed(true);
				});
		}, 250);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [api, code, minor, direction]);
	return { result, failed };
}

/**
 * The star: pins the currency's default exchange rate, or unpins every pin
 * it has. One change at a time, so a double tap does not flip it twice;
 * the list reads again afterwards. Pinning changes no money, so it has no
 * preview.
 */
export function useFavorite(reload: () => Promise<void>) {
	const t = useTranslations("mobile.currencies.toast");
	const { api } = useSession();
	const toast = useToast();
	const busy = useRef(false);
	const [pending, setPending] = useState(false);

	async function setFavorite(row: CurrencyRow, on: boolean) {
		const { add, remove } = pinChange(row, on);
		if (!api || busy.current || add.length + remove.length === 0) return;
		busy.current = true;
		setPending(true);
		try {
			for (const exchangeRateId of add)
				await api.settings.addFavoriteRate(
					{ exchangeRateId },
					{ context: { idempotencyKey: newClientId() } },
				);
			for (const exchangeRateId of remove)
				await api.settings.removeFavoriteRate(
					{ exchangeRateId },
					{ context: { idempotencyKey: newClientId() } },
				);
			await reload();
			toast.show({
				message: on
					? t("favorited", { code: row.code })
					: t("unfavorited", { code: row.code }),
			});
		} catch {
			toast.show({ message: t("failed") });
		} finally {
			busy.current = false;
			setPending(false);
		}
	}

	return { setFavorite, pending };
}
