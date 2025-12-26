import "~/styles/globals.css";

import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { ThemeProvider, ThemeScript } from "~/components/theme-provider";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
	title: "Retrospend",
	description: "Retrospend",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

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
			className={`${jetbrainsMono.variable}`}
			lang="en"
			suppressHydrationWarning
		>
			<head>
				<ThemeScript />
			</head>
			<body>
				<ThemeProvider>
					<TRPCReactProvider>{children}</TRPCReactProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
