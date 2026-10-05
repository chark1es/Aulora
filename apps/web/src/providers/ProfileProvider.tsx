import {
  createServerProfile,
  type ProfileStore,
  type ServerProfile,
  type WellKnown,
  webLocalStorageStore,
} from "@aulora/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ProfileContextValue {
  readonly store: ProfileStore;
  readonly profiles: readonly ServerProfile[];
  readonly activeProfile?: ServerProfile;
  readonly ready: boolean;
  /** Saves a validated well-known document as a profile and makes it active. */
  readonly addProfile: (_baseUrl: string, _wellKnown: WellKnown) => Promise<ServerProfile>;
  readonly setActive: (_id: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export interface ProfileProviderProps {
  /** Injectable for tests; defaults to the browser localStorage store. */
  readonly store?: ProfileStore;
  readonly children: ReactNode;
}

export function ProfileProvider({ store, children }: ProfileProviderProps) {
  const profileStore = useMemo(() => store ?? webLocalStorageStore(), [store]);
  const [profiles, setProfiles] = useState<readonly ServerProfile[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([profileStore.list(), profileStore.getActive()]);
    setProfiles(list);
    setActiveId(active?.id);
  }, [profileStore]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [list, active] = await Promise.all([profileStore.list(), profileStore.getActive()]);
      if (controller.signal.aborted) {
        return;
      }
      setProfiles(list);
      setActiveId(active?.id);
      setReady(true);
    })();
    return () => {
      controller.abort();
    };
  }, [profileStore]);

  const addProfile = useCallback(
    async (baseUrl: string, wellKnown: WellKnown) => {
      const profile = createServerProfile(baseUrl, wellKnown);
      await profileStore.add(profile);
      await profileStore.setActive(profile.id);
      await refresh();
      return profile;
    },
    [profileStore, refresh],
  );

  const setActive = useCallback(
    async (id: string) => {
      await profileStore.setActive(id);
      setActiveId(id);
    },
    [profileStore],
  );

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeId),
    [profiles, activeId],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      store: profileStore,
      profiles,
      ...(activeProfile !== undefined ? { activeProfile } : {}),
      ready,
      addProfile,
      setActive,
      refresh,
    }),
    [profileStore, profiles, activeProfile, ready, addProfile, setActive, refresh],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/** Reads the profile context; throws when used outside a {@link ProfileProvider}. */
export function useProfiles(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (value === null) {
    throw new Error("useProfiles must be used within a ProfileProvider.");
  }
  return value;
}
