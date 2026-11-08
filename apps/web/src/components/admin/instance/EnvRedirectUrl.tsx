import { Icon, IconButton, Text } from "@aulora/ui-web";
import { useClipboardCopy } from "../useClipboardCopy";

/**
 * The redirect (callback) URL to register with an identity provider, with a
 * copy button. The server only knows it once `SITE_URL` (or the Convex site
 * URL) is set, so otherwise this says what is missing.
 */
export function EnvRedirectUrl({ url }: { readonly url: string | null }) {
  if (url === null) {
    return (
      <Text size="xs" tone="muted" className="mt-0.5">
        Redirect URL unavailable: set SITE_URL on the deployment first.
      </Text>
    );
  }
  return <RedirectUrlRow url={url} />;
}

function RedirectUrlRow({ url }: { readonly url: string }) {
  const { copied, copy } = useClipboardCopy(url);
  return (
    <div className="env-redirect" data-testid="env-redirect-url">
      <span className="sr-only">Redirect URL: </span>
      <code className="min-w-0 font-mono text-[11px] leading-4 text-text-muted [overflow-wrap:anywhere]">
        {url}
      </code>
      <IconButton
        label={copied ? "Copied" : "Copy redirect URL"}
        title="Copy redirect URL"
        size="sm"
        onClick={copy}
      >
        <Icon name={copied ? "check" : "copy"} size={13} />
      </IconButton>
    </div>
  );
}
