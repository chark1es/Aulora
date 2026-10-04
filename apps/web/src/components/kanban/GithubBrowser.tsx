import { Button, Input, Modal, Spinner } from "@aulora/ui-web";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { GitHubBrowseResult } from "../../../../../packages/convex/convex/kanbanGithub";
import { control, failure } from "./types";

export function GithubBrowser({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick?: (item: { url: string; title: string }) => void;
}) {
  const status = useQuery(api.kanbanGithub.status, {});
  const connect = useMutation(api.kanbanGithub.connect);
  const disconnect = useMutation(api.kanbanGithub.disconnect);
  const browse = useAction(api.kanbanGithub.browse);
  const [token, setToken] = useState("");
  const [repository, setRepository] = useState("");
  const [kind, setKind] = useState<"issues" | "pulls">("issues");
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [result, setResult] = useState<GitHubBrowseResult | null>(null);
  const [page, setPage] = useState(1);
  const [loadedRepo, setLoadedRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(repo = repository.trim(), nextPage = 1) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await browse({
        ...(repo ? { repository: repo } : {}),
        kind,
        state,
        page: nextPage,
      });
      setResult(data);
      setPage(nextPage);
      setLoadedRepo(repo);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      label="GitHub"
      description="Browse with your own GitHub access. Linking a title or URL shares it with everyone who can read this board."
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pb-5">
        {status === undefined ? (
          <Spinner label="Loading GitHub connection" />
        ) : !status.connected ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              void connect({ token })
                .then(() => {
                  setToken("");
                  setResult(null);
                })
                .catch((cause: unknown) => setError(failure(cause)))
                .finally(() => setBusy(false));
            }}
          >
            <Input
              label="GitHub personal access token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              hint="Use a fine-grained token limited to the repositories you need, with read access to metadata, issues and pull requests. Your token is encrypted and only used on the server."
            />
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
              className="text-[13px] text-accent underline underline-offset-2"
            >
              Create a GitHub token
            </a>
            <Button type="submit" loading={busy} disabled={!token.trim()} className="self-start">
              Connect GitHub
            </Button>
          </form>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-text-muted">Your GitHub connection</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  setResult(null);
                  void disconnect({})
                    .catch((cause: unknown) => setError(failure(cause)))
                    .finally(() => setBusy(false));
                }}
              >
                Disconnect
              </Button>
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void load();
              }}
            >
              <Input
                label="Repository"
                placeholder="owner/repository"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                hint="Leave empty to list your repositories."
              />
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-xs text-text-muted">
                  Type
                  <select
                    className={control}
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as "issues" | "pulls");
                      setResult(null);
                    }}
                  >
                    <option value="issues">Issues</option>
                    <option value="pulls">Pull requests</option>
                  </select>
                </label>
                <label className="flex min-w-[120px] flex-1 flex-col gap-1 text-xs text-text-muted">
                  State
                  <select
                    className={control}
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value as "open" | "closed" | "all");
                      setResult(null);
                    }}
                  >
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="all">All</option>
                  </select>
                </label>
                <Button type="submit" loading={busy}>
                  Browse
                </Button>
              </div>
            </form>
            {busy && (
              <p role="status" className="text-sm text-text-muted">
                Loading GitHub…
              </p>
            )}
            {result && (
              <div className="divide-y divide-border">
                {result.repositories.map((r) => (
                  <div key={r.name} className="flex items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <a
                        className="break-words text-[13px] font-medium text-text hover:text-accent"
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.name}
                      </a>
                      <p className="text-xs text-text-muted">
                        {r.private ? "Private" : "Public"}
                        {r.description ? ` · ${r.description}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setRepository(r.name);
                        void load(r.name);
                      }}
                    >
                      View
                    </Button>
                    {onPick && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onPick({ url: r.url, title: r.name })}
                      >
                        Link
                      </Button>
                    )}
                  </div>
                ))}
                {result.items.map((item) => (
                  <div key={item.url} className="flex items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <a
                        className="break-words text-[13px] font-medium text-text hover:text-accent"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        #{item.number} {item.title}
                      </a>
                      <p className="text-xs text-text-muted">
                        {item.kind === "pull" ? "Pull request" : "Issue"} ·{" "}
                        {item.draft ? "Draft" : item.state} · Updated{" "}
                        {new Date(item.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    {onPick && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onPick({ url: item.url, title: item.title })}
                      >
                        Link
                      </Button>
                    )}
                  </div>
                ))}
                {!result.repositories.length && !result.items.length && (
                  <p className="py-5 text-sm text-text-muted">No results on this page.</p>
                )}
              </div>
            )}
            {result && (
              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1 || busy}
                  onClick={() => void load(loadedRepo, page - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-text-muted">Page {page}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!result.hasMore || busy}
                  onClick={() => void load(loadedRepo, page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
