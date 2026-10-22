import { loadCatalog } from "@retrospend/i18n/load";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const en = await loadCatalog("en");

/** Server-renders a kit component with the English catalog. */
export function render(node: ReactNode, locale = "en"): string {
	return renderToStaticMarkup(
		createElement(NextIntlClientProvider, {
			locale,
			messages: en,
			timeZone: "UTC",
			onError: (error) => {
				throw error;
			},
			children: node,
		}),
	);
}

/** The English kit catalog, for expected words. */
export const kit = en.kit as Record<string, Record<string, string>>;
