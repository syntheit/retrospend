import { LegalHeader } from "~/app/_components/landing/legal-header";

export default function PrivacyLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="h-screen overflow-y-auto">
			<LegalHeader />
			{children}
		</div>
	);
}
