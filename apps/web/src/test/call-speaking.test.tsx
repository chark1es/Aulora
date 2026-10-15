import { type CallParticipantView, DEFAULT_VOICE_SETTINGS } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CallGrid } from "../components/voice/CallParticipant";

const self: CallParticipantView = {
  userId: "self",
  muted: false,
  deafened: false,
  video: false,
  sharingScreen: false,
  sfu: false,
  joinedAt: 0,
  clientId: null,
  session: 1,
  speaking: false,
  audioLevel: 0,
  connection: "connected",
};

describe("voice speaking indicator", () => {
  it("shows a visible indicator on the local tile while the user is speaking", () => {
    render(
      <CallGrid
        participants={[self]}
        streams={new Map()}
        localUserId="self"
        localVideoTrack={null}
        settings={DEFAULT_VOICE_SETTINGS}
        identity={{ nameOf: () => "Me", colorOf: () => null }}
        speakingIds={new Set()}
        localSpeaking
      />,
    );
    expect(screen.getByText("Speaking")).toBeVisible();
  });
});
