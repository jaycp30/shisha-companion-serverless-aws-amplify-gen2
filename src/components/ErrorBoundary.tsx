import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Without a boundary, ANY uncaught error thrown during render unmounts the whole
 * React tree and leaves the user staring at a blank page (exactly what happened
 * when analyzeMenu returned a string instead of an object). This catches it and
 * shows something human instead.
 *
 * Error boundaries must be class components — React has no hook equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Deliberate: surface the real cause for debugging rather than swallowing it.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-petal bg-cream p-6 leading-relaxed">
          <p className="font-semibold">Something went sideways. 🐾</p>
          <p className="mt-2 text-espresso-soft">
            Reload the page and try again — the details are in the browser console.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
