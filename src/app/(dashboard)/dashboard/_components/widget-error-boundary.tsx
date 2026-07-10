"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "~/components/ui/button";

interface Props {
	children: ReactNode;
	widgetName: string;
}

interface State {
	hasError: boolean;
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
	const t = useTranslations("dashboard");

	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
			<AlertTriangle className="h-8 w-8 text-muted-foreground" />
			<div>
				<p className="font-medium text-sm">
					{t("widgets.errorBoundary.somethingWentWrong")}
				</p>
				<p className="text-muted-foreground text-xs">
					{t("widgets.errorBoundary.widgetCouldntLoad")}
				</p>
			</div>
			<Button onClick={onRetry} size="sm" variant="ghost">
				<RotateCcw className="mr-2 h-3 w-3" />
				{t("widgets.errorBoundary.retry")}
			</Button>
		</div>
	);
}

export class WidgetErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error(`Widget "${this.props.widgetName}" error:`, error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<ErrorFallback onRetry={() => this.setState({ hasError: false })} />
			);
		}

		return this.props.children;
	}
}
