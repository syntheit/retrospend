import "~/styles/globals.css";

import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { FontProvider, FontScript } from "~/components/font-provider";
import { ThemeProvider, ThemeScript } from "~/components/theme-provider";
import { Toaster } from "~/components/ui/sonner";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	metadataBase: new URL(
		process.env.PUBLIC_URL ||
			process.env.NEXT_PUBLIC_APP_URL ||
			"http://localhost:1997",
	),
	title: {
		default: "Retrospend",
		template: "%s | Retrospend",
	},
	description: "Expenses, budgets, and wealth tracking. Without the bloat.",
	openGraph: {
		type: "website",
		siteName: "Retrospend",
		title: "Retrospend — The Financial Multitool",
		description: "Expenses, budgets, and wealth tracking. Without the bloat.",
	},
	twitter: {
		card: "summary_large_image",
		title: "Retrospend — The Financial Multitool",
		description: "Expenses, budgets, and wealth tracking. Without the bloat.",
	},
	icons: [
		{ rel: "icon", url: "/favicon.ico" },
		{
			rel: "icon",
			url: "/favicon-16x16.png",
			sizes: "16x16",
			type: "image/png",
		},
		{
			rel: "icon",
			url: "/favicon-32x32.png",
			sizes: "32x32",
			type: "image/png",
		},
		{ rel: "apple-touch-icon", url: "/apple-touch-icon.png" },
	],
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};

const dmSans = DM_Sans({
	subsets: ["latin"],
	variable: "--font-dm-sans",
	display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-jetbrains-mono",
	display: "swap",
});

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			className={`${dmSans.variable} ${jetbrainsMono.variable}`}
			lang="en"
			suppressHydrationWarning
		>
			<head>
				<FontScript />
				<ThemeScript />
			</head>
			<body className="overflow-hidden">
				<ThemeProvider>
					<TRPCReactProvider>
						<FontProvider>
							{children}
							<Toaster />
						</FontProvider>
					</TRPCReactProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
