import "~/styles/globals.css";
import "flag-icons/css/flag-icons.min.css";

import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { FontProvider, FontScript } from "~/components/font-provider";
import { ThemeProvider, ThemeScript } from "~/components/theme-provider";
import { Toaster } from "~/components/ui/sonner";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	title: "Retrospend",
	description: "Retrospend",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
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
