"use client";

import { IconRefresh } from "@tabler/icons-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "~/components/ui/button";

interface Props {
	children?: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * ErrorBoundary component to catch rendering errors and provide a fallback UI.
 * Standard implementation as required by React for catching errors.
 */
export class ErrorBoundary extends Component<Props, State> {
	public state: State = {
		hasError: false,
		error: null,
	};

	public static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error("Uncaught error:", error, errorInfo);
	}

	private handleReset = () => {
		this.setState({ hasError: false, error: null });
	};

	public override render() {
		if (this.state.hasError) {
			if (this.props.fallback) return this.props.fallback;

			return (
				<div className="flex flex-col items-center justify-center space-y-4 rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
					<div className="space-y-2">
						<h3 className="font-semibold text-destructive text-lg">
							Something went wrong
						</h3>
						<p className="text-muted-foreground text-sm">
							{this.state.error?.message ||
								"An unexpected error occurred while rendering this component."}
						</p>
					</div>
					<Button
						className="gap-2"
						onClick={this.handleReset}
						size="sm"
						variant="outline"
					>
						<IconRefresh className="size-4" />
						Try again
					</Button>
				</div>
			);
		}

		return this.props.children;
	}
}
