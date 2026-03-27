import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TermsContent } from "~/components/legal/terms-content";
import { Button } from "~/components/ui/button";

export const metadata: Metadata = {
	title: "Terms and Conditions",
	description: "Retrospend terms and conditions.",
};

export default function TermsPage() {
	return (
		<div className="container mx-auto max-w-4xl px-4 py-12">
			<Button asChild className="mb-6" size="sm" variant="ghost">
				<Link href="/">
					<ArrowLeft className="mr-1.5 h-4 w-4" />
					Return Home
				</Link>
			</Button>
			<TermsContent />
		</div>
	);
}
