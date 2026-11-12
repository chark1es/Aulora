import { GUEST_LINK_GENERIC_ERROR, Permission } from "@aulora/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GUEST_CHOICES } from "../components/guest/DeviceCheck";
import { GuestErrorBoundary } from "../components/guest/GuestErrorBoundary";
import { GuestJoinForm } from "../components/guest/GuestJoinForm";
import { GuestMessageScreen } from "../components/guest/GuestMessageScreen";
import { GuestSession } from "../components/guest/GuestSession";
import { GuestLobbyPrompt } from "../components/voice/GuestLobbyPrompt";
import { GuestLinkDialog, InviteGuestDialog } from "../components/voice/InviteGuestDialog";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  queryArgs: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  voice: {} as Record<string, unknown>,
}));

function mutationFor(name: string) {
  if (!state.mutations.has(name)) {
    state.mutations.set(name, vi.fn().mockResolvedValue(null));
  }
  return state.mutations.get(name);
}

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    state.queryArgs.set(getFunctionName(reference), args);
    return args === "skip" ? undefined : state.values.get(getFunctionName(reference));
  },
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    mutationFor(getFunctionName(reference)),
}));

vi.mock("../components/guest/use-guest-engine", () => ({
  useGuestEngine: () => null,
}));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => state.voice,
}));

beforeEach(() => {
  state.values.clear();
  state.queryArgs.clear();
  state.mutations.clear();
  state.voice = {
    call: { id: "call1", channelId: "ch1", scheduledCallId: null },
    setInviteGuestOpen: vi.fn(),
    addons: { transcription: false, guestCalls: true, scheduledCalls: false },
    permissions: Permission.CreateGuestLinks,
  };
});

const TOKEN = `agu_${"A".repeat(43)}`;
const FUTURE = Date.now() + 3_600_000;

function form(overrides: Partial<Parameters<typeof GuestJoinForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <GuestJoinForm
      linkToken={TOKEN}
      choices={DEFAULT_GUEST_CHOICES}
      onChoices={vi.fn()}
      busy={false}
      failure={null}
      onTitle={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return onSubmit;
}

describe("GuestJoinForm", () => {
  it("opens the invite with the call's title and requires a name before asking to join", async () => {
    state.values.set("guestCalls:preview", {
      title: "Design review",
      open: true,
      startsAt: null,
      opensAt: null,
    });
    const user = userEvent.setup();
    const onSubmit = form();
    expect(screen.getByRole("heading", { name: "Design review" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask to join" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your name so people know who you are.")).toBeInTheDocument();
  });

  it("sends a normalized name and the optional affiliation", async () => {
    state.values.set("guestCalls:preview", {
      title: "t",
      open: true,
      startsAt: null,
      opensAt: null,
    });
    const user = userEvent.setup();
    const onSubmit = form();
    await user.type(screen.getByLabelText("Your name"), "  Alex‮   Visitor ");
    await user.type(screen.getByLabelText("Company or role (optional)"), "Acme");
    await user.click(screen.getByRole("button", { name: "Ask to join" }));
    expect(onSubmit).toHaveBeenCalledWith({ displayName: "Alex Visitor", affiliation: "Acme" });
  });

  it("explains a call that has not started, with the local time, and blocks asking", () => {
    const startsAt = Date.now() + 3_600_000;
    state.values.set("guestCalls:preview", {
      title: "Planning",
      open: false,
      startsAt,
      opensAt: startsAt - 300_000,
    });
    form();
    expect(screen.getByTestId("guest-not-started")).toHaveTextContent(
      "The call hasn’t started yet",
    );
    expect(screen.getByRole("button", { name: "Ask to join" })).toBeDisabled();
  });

  it("waits for the host when no call is live, and says so without a time", () => {
    state.values.set("guestCalls:preview", {
      title: "Guest call",
      open: false,
      startsAt: null,
      opensAt: null,
    });
    form();
    expect(screen.getByTestId("guest-waiting-for-host")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask to join" })).toBeDisabled();
  });

  it("shows only generic words for a failed request", () => {
    state.values.set("guestCalls:preview", {
      title: "t",
      open: true,
      startsAt: null,
      opensAt: null,
    });
    form({ failure: { kind: "generic" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});

describe("guest page shell", () => {
  it("renders a fixed screen for a bad link and never the error", () => {
    function Boom(): never {
      throw new Error(GUEST_LINK_GENERIC_ERROR);
    }
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <GuestErrorBoundary
        fallback={() => (
          <GuestMessageScreen icon="link" title="This guest link isn’t available">
            Ask for a new link.
          </GuestMessageScreen>
        )}
      >
        <Boom />
      </GuestErrorBoundary>,
    );
    quiet.mockRestore();
    expect(
      screen.getByRole("heading", { name: "This guest link isn’t available" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(GUEST_LINK_GENERIC_ERROR)).toBeNull();
  });
});

describe("GuestLobbyPrompt", () => {
  it("renders nothing for a participant who may not answer guests, and never reads the lobby", () => {
    state.values.set("guestCalls:lobbyAccess", { canManage: false });
    state.values.set("guestCalls:lobbyList", {
      pending: [
        { guestSessionId: "g1", displayName: "Alex", affiliation: null, expiresAt: FUTURE },
      ],
      admitted: [],
    });
    const { container } = render(<GuestLobbyPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists who is waiting, with affiliation, and admits or denies by name", async () => {
    state.values.set("guestCalls:lobbyAccess", { canManage: true });
    state.values.set("guestCalls:lobbyList", {
      pending: [
        { guestSessionId: "g1", displayName: "Alex", affiliation: "Acme", expiresAt: FUTURE },
        { guestSessionId: "g2", displayName: "Sam", affiliation: null, expiresAt: FUTURE },
      ],
      admitted: [
        { guestSessionId: "g3", displayName: "Kim", affiliation: null, expiresAt: FUTURE },
      ],
    });
    const user = userEvent.setup();
    render(<GuestLobbyPrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("2 people are waiting");
    const list = screen.getByRole("complementary", { name: "Guests" });
    expect(within(list).getByText("Acme")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Admit Alex" }));
    expect(mutationFor("guestCalls:admit")).toHaveBeenCalledWith({ guestSessionId: "g1" });
    await user.click(screen.getByRole("button", { name: "Deny Sam" }));
    expect(mutationFor("guestCalls:deny")).toHaveBeenCalledWith({ guestSessionId: "g2" });
    await user.click(screen.getByRole("button", { name: "Remove Kim from the call" }));
    expect(mutationFor("guestCalls:remove")).toHaveBeenCalledWith({ guestSessionId: "g3" });
    // Admitted guests carry a Guest badge.
    expect(within(list).getByText("Guest")).toBeInTheDocument();
  });

  it("never offers Admit for a request that has already expired", () => {
    state.values.set("guestCalls:lobbyAccess", { canManage: true });
    state.values.set("guestCalls:lobbyList", {
      pending: [
        { guestSessionId: "g1", displayName: "Alex", affiliation: null, expiresAt: Date.now() - 1 },
        { guestSessionId: "g2", displayName: "Sam", affiliation: null, expiresAt: FUTURE },
      ],
      admitted: [
        { guestSessionId: "g3", displayName: "Kim", affiliation: null, expiresAt: Date.now() - 1 },
      ],
    });
    render(<GuestLobbyPrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("1 person is waiting");
    expect(screen.queryByRole("button", { name: "Admit Alex" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny Alex" })).toBeNull();
    expect(screen.getByRole("button", { name: "Admit Sam" })).toBeInTheDocument();
    // A session past its cap is already over on the server: no Remove for it either.
    expect(screen.queryByRole("button", { name: "Remove Kim from the call" })).toBeNull();
  });

  it("drops a request from the prompt when its clock runs out, without a refetch", () => {
    vi.useFakeTimers();
    try {
      state.values.set("guestCalls:lobbyAccess", { canManage: true });
      state.values.set("guestCalls:lobbyList", {
        pending: [
          {
            guestSessionId: "g1",
            displayName: "Alex",
            affiliation: null,
            expiresAt: Date.now() + 5_000,
          },
        ],
        admitted: [],
      });
      render(<GuestLobbyPrompt />);
      expect(screen.getByRole("button", { name: "Admit Alex" })).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5_100);
      });
      expect(screen.queryByRole("button", { name: "Admit Alex" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the singular for one person", () => {
    state.values.set("guestCalls:lobbyAccess", { canManage: true });
    state.values.set("guestCalls:lobbyList", {
      pending: [
        { guestSessionId: "g1", displayName: "Alex", affiliation: null, expiresAt: FUTURE },
      ],
      admitted: [],
    });
    render(<GuestLobbyPrompt />);
    expect(screen.getByRole("status")).toHaveTextContent("1 person is waiting");
  });
});

describe("InviteGuestDialog", () => {
  it("creates a link for the channel call and shows it once, ready to copy", async () => {
    const create = mutationFor("guestCalls:createLink");
    create?.mockResolvedValueOnce({
      linkId: "l1",
      token: TOKEN,
      url: `https://chat.example.com/call/guest#${TOKEN}`,
      expiresAt: Date.now() + 3_600_000,
      maxUses: 5,
    });
    const user = userEvent.setup();
    render(<InviteGuestDialog />);
    await user.click(screen.getByRole("button", { name: "Create link" }));
    expect(create).toHaveBeenCalledWith({
      channelId: "ch1",
      expiresInMs: 3_600_000,
      maxUses: 5,
    });
    const link = await screen.findByLabelText("Guest link");
    expect(link).toHaveValue(`https://chat.example.com/call/guest#${TOKEN}`);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByText(/shown only once/u)).toBeInTheDocument();
  });

  it("validates the number of people before creating", async () => {
    const user = userEvent.setup();
    render(<InviteGuestDialog />);
    const people = screen.getByLabelText("People it can admit");
    await user.clear(people);
    await user.type(people, "99");
    expect(screen.getByRole("button", { name: "Create link" })).toBeDisabled();
    expect(screen.getByText("Enter a number from 1 to 25")).toBeInTheDocument();
  });

  it("targets a scheduled call when the call has no channel", async () => {
    state.voice = {
      ...state.voice,
      call: { id: "call2", channelId: null, scheduledCallId: "sc9" },
    };
    const create = mutationFor("guestCalls:createLink");
    create?.mockResolvedValueOnce({
      linkId: "l",
      token: TOKEN,
      url: "https://x/call/guest#t",
      expiresAt: Date.now() + 1000,
      maxUses: 5,
    });
    const user = userEvent.setup();
    render(<InviteGuestDialog />);
    await user.click(screen.getByRole("button", { name: "Create link" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ scheduledCallId: "sc9" }));
  });

  it("lists links with their state for a lobby manager, and revokes only active ones", async () => {
    state.values.set("guestCalls:lobbyAccess", { canManage: true });
    state.values.set("guestCalls:links", [
      {
        id: "a",
        createdBy: "u",
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() + 100000,
        maxUses: 5,
        uses: 1,
        revoked: false,
        label: null,
      },
      {
        id: "b",
        createdBy: "u",
        createdAt: Date.now() - 2000,
        expiresAt: Date.now() + 100000,
        maxUses: 5,
        uses: 0,
        revoked: true,
        label: null,
      },
    ]);
    const user = userEvent.setup();
    render(<InviteGuestDialog />);
    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(mutationFor("guestCalls:revokeLink")).toHaveBeenCalledWith({ linkId: "a" });
    });
  });

  it("lists a scheduled call's links by its own id, before any call has started", async () => {
    state.voice = { ...state.voice, call: null };
    state.values.set("guestCalls:links", [
      {
        id: "s1",
        createdBy: "u",
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() + 100000,
        maxUses: 3,
        uses: 2,
        revoked: false,
        label: null,
      },
    ]);
    const user = userEvent.setup();
    render(<GuestLinkDialog target={{ scheduledCallId: "sc7" }} callId={null} onClose={vi.fn()} />);
    expect(state.queryArgs.get("guestCalls:links")).toEqual({ scheduledCallId: "sc7" });
    // No call id exists, so the lobby-access probe is never made.
    expect(state.queryArgs.get("guestCalls:lobbyAccess")).toBe("skip");
    expect(await screen.findByText("2 of 3 admitted")).toBeInTheDocument();
    expect(screen.getByText(/ends/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(mutationFor("guestCalls:revokeLink")).toHaveBeenCalledWith({ linkId: "s1" });
    });
  });

  it("keeps the show-once panel after creating a scheduled call's link, with the list beneath", async () => {
    mutationFor("guestCalls:createLink")?.mockResolvedValueOnce({
      linkId: "l2",
      token: TOKEN,
      url: `https://chat.example.com/call/guest#${TOKEN}`,
      expiresAt: Date.now() + 3_600_000,
      maxUses: 5,
    });
    state.values.set("guestCalls:links", []);
    const user = userEvent.setup();
    render(<GuestLinkDialog target={{ scheduledCallId: "sc7" }} callId={null} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Create link" }));
    expect(mutationFor("guestCalls:createLink")).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledCallId: "sc7" }),
    );
    expect(await screen.findByLabelText("Guest link")).toHaveValue(
      `https://chat.example.com/call/guest#${TOKEN}`,
    );
    expect(screen.getByText("Links for this call")).toBeInTheDocument();
  });

  it("uses the live call id for a channel call, and only for a lobby manager", () => {
    state.values.set("guestCalls:lobbyAccess", { canManage: true });
    state.values.set("guestCalls:links", []);
    render(<InviteGuestDialog />);
    expect(state.queryArgs.get("guestCalls:links")).toEqual({ callId: "call1" });
  });

  it("does not list links to someone who cannot manage the lobby", () => {
    state.values.set("guestCalls:lobbyAccess", { canManage: false });
    render(<InviteGuestDialog />);
    expect(screen.queryByText("Links for this call")).toBeNull();
  });
});

describe("GuestSession lobby states", () => {
  function lobby(status: string) {
    return {
      guestSessionId: "gsid1",
      status,
      displayName: "Alex",
      affiliation: null,
      callId: "call1",
      expiresAt: Date.now() + 600_000,
    };
  }
  function session(askAgain: (() => void) | null = vi.fn()) {
    const props = {
      client: { mutation: vi.fn().mockResolvedValue(null) } as never,
      convexUrl: "https://convex.example.com",
      sessionToken: `ags_${"0123456789abcdef".repeat(4)}`,
      title: "Guest call",
      choices: DEFAULT_GUEST_CHOICES,
      onFinished: vi.fn(),
      onAskAgain: askAgain,
    };
    const view = render(<GuestSession {...props} />);
    return { ...props, view, rerender: () => view.rerender(<GuestSession {...props} />) };
  }

  it("says a request that nobody answered expired, and offers Ask again", async () => {
    state.values.set("guestCalls:lobby", lobby("expired"));
    const askAgain = vi.fn();
    const user = userEvent.setup();
    const { onFinished } = session(askAgain);
    expect(screen.getByRole("heading", { name: "Your request expired" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask again" }));
    expect(askAgain).toHaveBeenCalledTimes(1);
    // The session credential is dropped once the visit is over.
    expect(onFinished).toHaveBeenCalled();
  });

  it("tells an admitted guest whose session ran out that the call ended for them, never 'Joining'", () => {
    state.values.set("guestCalls:lobby", lobby("pending"));
    const { rerender, onFinished } = session();
    expect(screen.getByRole("heading", { name: "Waiting to be let in" })).toBeInTheDocument();
    state.values.set("guestCalls:lobby", lobby("admitted"));
    rerender();
    expect(onFinished).not.toHaveBeenCalled();
    // Past its cap, the server reports the session as expired on its own.
    state.values.set("guestCalls:lobby", lobby("expired"));
    rerender();
    expect(screen.getByRole("heading", { name: "The call has ended for you" })).toBeInTheDocument();
    expect(screen.queryByText(/Joining/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask again" })).toBeNull();
    expect(onFinished).toHaveBeenCalled();
  });

  it("leaves 'Waiting' for the ended screen when the call ends while the guest is in the lobby", () => {
    // The server reports a pending or admitted guest whose call ended as `left`.
    state.values.set("guestCalls:lobby", lobby("pending"));
    const { rerender, onFinished } = session();
    expect(screen.getByRole("heading", { name: "Waiting to be let in" })).toBeInTheDocument();
    state.values.set("guestCalls:lobby", { ...lobby("left"), callId: "call1" });
    rerender();
    expect(screen.queryByRole("heading", { name: "Waiting to be let in" })).toBeNull();
    expect(screen.getByRole("heading", { name: "The call has ended for you" })).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalled();
  });

  describe("a request that lapses while the page is open", () => {
    const FIVE_MIN = 5 * 60_000;
    const waiting = (expiresAt: number, status = "pending") => ({
      guestSessionId: "gsid1",
      status,
      displayName: "Alex",
      affiliation: null,
      callId: "call1",
      expiresAt,
    });

    it("moves from waiting to 'Your request expired' at expiresAt with no new data", () => {
      vi.useFakeTimers();
      try {
        state.values.set("guestCalls:lobby", waiting(Date.now() + FIVE_MIN));
        const { onFinished } = session();
        expect(screen.getByRole("heading", { name: "Waiting to be let in" })).toBeInTheDocument();
        act(() => {
          vi.advanceTimersByTime(FIVE_MIN - 1_000);
        });
        expect(screen.getByRole("heading", { name: "Waiting to be let in" })).toBeInTheDocument();
        expect(onFinished).not.toHaveBeenCalled();
        // The server's value never changed: the page ends the wait itself.
        act(() => {
          vi.advanceTimersByTime(1_500);
        });
        expect(screen.getByRole("heading", { name: "Your request expired" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ask again" })).toBeInTheDocument();
        expect(onFinished).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears its timer when the page goes away", () => {
      vi.useFakeTimers();
      try {
        state.values.set("guestCalls:lobby", waiting(Date.now() + FIVE_MIN));
        const { view } = session();
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not touch an admitted session", () => {
      vi.useFakeTimers();
      try {
        state.values.set("guestCalls:lobby", waiting(Date.now() + FIVE_MIN, "admitted"));
        const { onFinished } = session();
        expect(vi.getTimerCount()).toBe(0);
        act(() => {
          vi.advanceTimersByTime(FIVE_MIN + 60_000);
        });
        expect(screen.queryByRole("heading", { name: "Your request expired" })).toBeNull();
        expect(screen.queryByRole("heading", { name: "The call has ended for you" })).toBeNull();
        expect(onFinished).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("trusts the server when it answers again and says the guest is still waiting", () => {
      vi.useFakeTimers();
      try {
        const expiresAt = Date.now() + FIVE_MIN;
        state.values.set("guestCalls:lobby", waiting(expiresAt));
        const { rerender } = session();
        act(() => {
          vi.advanceTimersByTime(FIVE_MIN + 1_000);
        });
        expect(screen.getByRole("heading", { name: "Your request expired" })).toBeInTheDocument();
        // A clock running ahead of the server's: the server says it has not lapsed.
        state.values.set("guestCalls:lobby", waiting(expiresAt));
        rerender();
        expect(screen.getByRole("heading", { name: "Waiting to be let in" })).toBeInTheDocument();
        act(() => {
          vi.advanceTimersByTime(60_000);
        });
        expect(screen.getByRole("heading", { name: "Waiting to be let in" })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets a guest who is admitted just before the deadline stay in the call", () => {
      vi.useFakeTimers();
      try {
        const expiresAt = Date.now() + FIVE_MIN;
        state.values.set("guestCalls:lobby", waiting(expiresAt));
        const { rerender, onFinished } = session();
        act(() => {
          vi.advanceTimersByTime(FIVE_MIN - 2_000);
        });
        state.values.set("guestCalls:lobby", waiting(expiresAt + 60_000, "admitted"));
        rerender();
        act(() => {
          vi.advanceTimersByTime(10_000);
        });
        expect(screen.queryByRole("heading", { name: "Your request expired" })).toBeNull();
        expect(onFinished).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("shows the ended screen when the session is already over", () => {
    state.values.set("guestCalls:lobby", lobby("left"));
    session();
    expect(screen.getByRole("heading", { name: "The call has ended for you" })).toBeInTheDocument();
  });
});
