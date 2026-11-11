import { Button } from "@aulora/ui-web";
import { useEffect, useRef, useState } from "react";
import {
  dismissLegacyRecovery,
  legacyRecovery,
  legacyRecoveryFailed,
  purgeLegacyStorage,
} from "../lib/legacy-storage";

export function LegacyRecoveryNotice({ scope }: { readonly scope: string }) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const [loadedScope, setLoadedScope] = useState(scope);
  const [texts, setTexts] = useState<readonly string[]>(() => legacyRecovery(scope));
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLoadedScope(scope);
    setTexts(legacyRecovery(scope));
    const refresh = () => {
      if (active) {
        setTexts(legacyRecovery(scope));
        setRecoveryFailed(legacyRecoveryFailed(scope));
      }
    };
    window.addEventListener("storage", refresh);
    void purgeLegacyStorage(scope).then(refresh);
    return () => {
      active = false;
      window.removeEventListener("storage", refresh);
    };
  }, [scope]);
  if (loadedScope !== scope || (texts.length === 0 && !recoveryFailed)) return null;
  return (
    <section
      aria-label="Unsent message recovery"
      className="border-b border-border bg-surface-2 p-4 text-text"
    >
      {recoveryFailed && (
        <p role="status">
          Couldn’t copy your old drafts. Your original drafts remain on this device.
        </p>
      )}
      {texts.length > 0 && (
        <p>
          {texts.length} unsent messages from before this update could not be delivered. Copy them
          below.
        </p>
      )}
      <ul className="max-h-60 overflow-auto">
        {texts.map((text, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: recovery order is immutable; duplicate plaintext needs distinct keys
          <li key={`${index}:${text}`} className="my-2 flex items-start gap-3">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans">{text}</pre>
            <Button
              size="sm"
              onClick={() => {
                if (!navigator.clipboard?.writeText) {
                  setCopyError(true);
                  return;
                }
                void navigator.clipboard
                  .writeText(text)
                  .then(() => {
                    setCopyError(false);
                    setCopied(index);
                  })
                  .catch(() => setCopyError(true));
              }}
            >
              {copied === index ? "Copied" : "Copy"}
            </Button>
          </li>
        ))}
      </ul>
      <span role="status" className="sr-only">
        {copied !== null ? "Copied" : ""}
      </span>
      {copyError && <p role="alert">Couldn’t copy. Select the text above and copy it manually.</p>}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          dismissLegacyRecovery(scope);
          const main = document.querySelector<HTMLElement>("main, [role='main']");
          const target = main ?? previousFocus.current;
          if (target && target !== document.body && target.isConnected) {
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus();
          }
          setTexts([]);
          setRecoveryFailed(false);
        }}
      >
        Dismiss
      </Button>
    </section>
  );
}
