import { Button, Spinner, Text } from "@aulora/ui-native";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { createReviewDemo, type ReviewDemo } from "../lib/review-demo";
import { useReviewDemoSession } from "../lib/review-demo-session";
import { SoundProvider } from "../providers/SoundProvider";
import { VoiceContext } from "../providers/voice-provider-types";
import { ChatScreenView } from "./chat/ChatScreen";
import { ChatScreenSessionProvider } from "./chat/chat-screen-session";
import { ScreenContainer } from "./layout/ScreenContainer";

export interface ReviewDemoScreenProps {
  readonly onExit: () => void;
  /** Screenshot capture hides the offline label so the surface reads as the app. */
  readonly showNotice?: boolean;
  /** Screenshot capture opens one named conversation first. */
  readonly initialChannelName?: string;
  /** Screenshot capture opens one thread first. */
  readonly initialThreadRootId?: string;
}

/** A visibly labeled, self-contained workspace running the real chat surfaces offline. */
export function ReviewDemoScreen({
  onExit,
  showNotice = true,
  initialChannelName,
  initialThreadRootId,
}: ReviewDemoScreenProps) {
  // The chat surface expects a Convex client for server-only sheets; nothing here
  // reaches it because every live surface reads the mock session instead.
  const client = useMemo(() => new ConvexReactClient("http://127.0.0.1:9"), []);
  const [demo, setDemo] = useState<ReviewDemo | undefined>();
  const [error, setError] = useState<string | null>(null);
  const session = useReviewDemoSession(demo, { initialChannelName, initialThreadRootId });

  useEffect(() => {
    let cancelled = false;
    let created: ReviewDemo | undefined;
    void createReviewDemo()
      .then((workspace) => {
        if (cancelled) {
          workspace.dispose();
          return;
        }
        created = workspace;
        setDemo(workspace);
      })
      .catch(() => {
        if (!cancelled) setError("Could not open the offline demo. Exit and try again.");
      });
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, []);

  if (demo === undefined || session === undefined) {
    return (
      <ScreenContainer className="flex-1 items-center justify-center bg-bg px-6 min-w-0">
        {error === null ? (
          <Spinner label="Opening offline demo" />
        ) : (
          <Text tone="danger" accessibilityRole="alert" className="text-center">
            {error}
          </Text>
        )}
      </ScreenContainer>
    );
  }

  return (
    <ConvexProvider client={client}>
      <SoundProvider>
        <VoiceContext.Provider value={session.voice}>
          <ChatScreenSessionProvider value={session}>
            <ChatScreenView
              workspaceName={session.workspaceName}
              ownUserId={session.ownUserId}
              ownDisplayName={session.ownDisplayName}
              onSignOut={onExit}
              onDeleteAccount={onExit}
              notice={showNotice ? <DemoNotice onExit={onExit} /> : undefined}
            />
          </ChatScreenSessionProvider>
        </VoiceContext.Provider>
      </SoundProvider>
    </ConvexProvider>
  );
}

/** The offline label and exit control, kept out of the shared chat surface. */
function DemoNotice({ onExit }: { readonly onExit: () => void }) {
  // While typing, only the label stays: at large text on a short phone the full
  // notice left too little room above the keyboard for a thread's composer.
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  return (
    <View className="flex-row items-center gap-3 border-b border-border bg-surface-2 px-4 py-2">
      <View className="min-w-0 flex-1">
        {/* Wraps instead of truncating at large text; the label is the only
            sign that nothing here reaches a server. */}
        <Text size="sm" maxFontSizeMultiplier={1.5}>
          Offline App Review demo
        </Text>
        {!keyboardVisible && (
          <Text size="xs" tone="muted" maxFontSizeMultiplier={1.5}>
            No server connection. Changes reset when you exit.
          </Text>
        )}
      </View>
      <Button size="sm" variant="secondary" onPress={onExit}>
        Exit demo
      </Button>
    </View>
  );
}
