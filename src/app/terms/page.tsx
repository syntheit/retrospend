import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { TermsContent } from "~/components/legal/terms-content";

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
