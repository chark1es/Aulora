import { Button } from "@aulora/ui-web";
import { Component, type ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
  readonly title: string;
  readonly onBack: () => void;
}

/**
 * Keeps a failed addon query (the addon was switched off, or access changed)
 * from taking the whole chat down with it, with a way back and a retry.
 */
export class AddonBoundary extends Component<Props, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <section className="pane flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-5">
        <h2 className="text-lg font-semibold">{this.props.title} could not load</h2>
        <p className="max-w-md text-center text-sm text-text-muted">
          The addon may have been turned off or your access may have changed. Return to chat, or
          retry.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={this.props.onBack}>
            Back to chat
          </Button>
          <Button
            onClick={() => {
              this.setState({ failed: false });
            }}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }
}
