import { Component, type ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
  /** What to show when a read fails. Never receives the error, so its text cannot leak. */
  readonly fallback: () => ReactNode;
}

/**
 * Catches a failed guest query. The guest functions answer every unusable link
 * or session with one error, and the page must say no more than that, so the
 * boundary deliberately discards the error object and renders a fixed screen.
 */
export class GuestErrorBoundary extends Component<Props, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback() : this.props.children;
  }
}
