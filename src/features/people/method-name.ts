"use client";

import { useTranslations } from "next-intl";
import { getPaymentMethodName } from "~/components/ui/payment-method-icon";

/**
 * A payment method's name: the generic ones (bank transfer, cash) in the
 * page's language and sentence case; brands (Mercado Pago, Pix) as they are.
 */
export function useMethodName() {
	const t = useTranslations("peoplePage.methods");
	return (type: string) => (t.has(type) ? t(type) : getPaymentMethodName(type));
}
