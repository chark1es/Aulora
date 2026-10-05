import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { acceptances, agreementFromText, checkPullRequest, run, saveSignatures } from "./cla.mjs";

const repo = { owner: "example", repo: "aulora" };
const text = "# CLA\n\nAgreement revision: 2026-09-30.\n\nThe agreement.\n";
const alice = { id: 1, login: "alice", type: "User" };
const bob = { id: 2, login: "bob", type: "User" };
const bot = { id: 3, login: "dependabot[bot]", type: "Bot" };
const agreement = agreementFromText(text, "example/aulora", "published");
const pull = {
  number: 7,
  state: "open",
  user: alice,
  head: { sha: "pr-head" },
  html_url: "https://github.com/example/aulora/pull/7",
};
function signature(user, body = agreement.statement) {
  return {
    id: user.id * 10,
    user,
    body,
    updated_at: "2026-09-30T12:00:00Z",
    html_url: `${pull.html_url}#issuecomment-${user.id * 10}`,
  };
}

function notFound() {
  return Object.assign(new Error("Not found"), { status: 404 });
}

// An in-memory Git store exercises archive creation, subsequent commits, and
// optimistic ref updates rather than mocking the signature persistence itself.
function fixture({ comments = [], authors = [alice], stored = [], pages, pr = pull } = {}) {
  const state = {
    comments: [...comments],
    authors,
    statuses: [],
    trees: new Map(),
    commits: new Map(),
    head: null,
    text,
    conflict: null,
    commentWrites: 0,
  };
  let sequence = 0;
  const id = () => `object-${++sequence}`;
  if (stored.length) {
    state.trees.set("existing-tree", {
      [`agreements/${agreement.hash}/CLA.md`]: text,
      [`agreements/${agreement.hash}/signatures.json`]: JSON.stringify(stored),
    });
    state.commits.set("existing-head", { tree: { sha: "existing-tree" }, parents: [] });
    state.head = "existing-head";
  }
  const github = {
    rest: {
      repos: {
        getContent: async ({ path, ref }) => {
          const content =
            ref === "published"
              ? state.text
              : state.trees.get(state.commits.get(ref)?.tree.sha)?.[path];
          if (content === undefined) throw notFound();
          return {
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(content).toString("base64"),
            },
          };
        },
        createCommitStatus: async (status) => state.statuses.push(status),
      },
      git: {
        getRef: async ({ ref }) => {
          if (ref === "heads/main") return { data: { object: { sha: "published" } } };
          if (!state.head) throw notFound();
          return { data: { object: { sha: state.head } } };
        },
        getCommit: async ({ commit_sha }) => ({ data: state.commits.get(commit_sha) }),
        createTree: async ({ base_tree, tree }) => {
          const sha = id();
          const files = { ...state.trees.get(base_tree) };
          for (const entry of tree) files[entry.path] = entry.content;
          state.trees.set(sha, files);
          return { data: { sha } };
        },
        createCommit: async ({ tree, parents }) => {
          const sha = id();
          state.commits.set(sha, { tree: { sha: tree }, parents });
          return { data: { sha } };
        },
        createRef: async ({ sha }) => {
          if (state.head) throw Object.assign(new Error("Ref exists"), { status: 422 });
          state.head = sha;
        },
        updateRef: async ({ sha, force }) => {
          expect(force).toBe(false);
          if (state.conflict) {
            const conflict = state.conflict;
            state.conflict = null;
            await conflict();
          }
          if (state.commits.get(sha).parents[0] !== state.head) {
            throw Object.assign(new Error("Not fast-forward"), { status: 422 });
          }
          state.head = sha;
        },
      },
      pulls: {
        get: async () => ({ data: pr }),
        list: async () => [pr],
      },
      issues: {
        listComments: async () => state.comments,
        createComment: async ({ body }) => {
          state.commentWrites++;
          state.comments.push({
            id: 99,
            user: { login: "github-actions[bot]", type: "Bot" },
            body,
          });
        },
        updateComment: async ({ comment_id, body }) => {
          state.commentWrites++;
          state.comments.find((comment) => comment.id === comment_id).body = body;
        },
      },
    },
    paginate: (method, args) => method(args),
    graphql: async (_query, { cursor }) => ({
      repository: {
        pullRequest: {
          headRefOid: pr.head.sha,
          commits: {
            pageInfo: { hasNextPage: Boolean(pages && !cursor), endCursor: "next-page" },
            nodes: [
              {
                commit: {
                  oid: "abcdef123",
                  authors: {
                    pageInfo: { hasNextPage: false },
                    nodes: (pages ? pages[cursor ? 1 : 0] : state.authors).map((user) => ({
                      name: user?.login ?? "Unlinked `author` @somebody",
                      user: user ? { databaseId: user.id, login: user.login } : null,
                    })),
                  },
                },
              },
            ],
          },
        },
      },
    }),
  };
  const records = (hash = agreement.hash) => {
    const files = state.trees.get(state.commits.get(state.head)?.tree.sha);
    return JSON.parse(files?.[`agreements/${hash}/signatures.json`] ?? "[]");
  };
  return { github, state, records };
}

test("agreement signatures bind exact text, including changes without a revision bump", () => {
  expect(agreement.hash).toHaveLength(64);
  expect(agreement.url).toContain("/blob/published/CLA.md");
  expect(agreementFromText(`${text}A change.`, "example/aulora", "new").statement).not.toBe(
    agreement.statement,
  );
  expect(() => agreementFromText("No revision", "example/aulora", "sha")).toThrow("revision");
});

test("only exact statements by the contributing account count", () => {
  const people = new Map([[alice.id, alice.login]]);
  const records = acceptances(
    [
      signature(bob),
      signature(bot),
      signature(alice, `> ${agreement.statement}`),
      signature(alice, agreement.statement.replace(agreement.hash, "old-hash")),
      signature(alice, ` ${agreement.statement}\n`),
      signature(alice),
    ],
    people,
    agreement,
    pull,
  );
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    userId: 1,
    login: "alice",
    agreementHash: agreement.hash,
    commentId: 10,
  });
});

test("unsigned PRs fail on the PR head and receive one reusable signing prompt", async () => {
  const { github, state } = fixture();
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.map((status) => status.state)).toEqual(["pending", "failure"]);
  expect(
    state.statuses.every((status) => status.sha === "pr-head" && status.context === "CLA"),
  ).toBe(true);
  expect(state.comments[0].body).toContain(agreement.statement);
  expect(state.head).toBeNull();
  await checkPullRequest(github, repo, "main", 7);
  expect(state.commentWrites).toBe(1);
});

test("a valid signature creates an independent branch with its immutable agreement", async () => {
  const { github, state, records } = fixture({ comments: [signature(alice)] });
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("success");
  expect(records()[0]).toMatchObject({
    acceptedAt: "2026-09-30T12:00:00Z",
    pullRequest: pull.html_url.toString(),
  });
  const commit = state.commits.get(state.head);
  expect(commit.parents).toEqual([]);
  expect(state.trees.get(commit.tree.sha)[`agreements/${agreement.hash}/CLA.md`]).toBe(text);
});

test("acceptance survives comment deletion and username changes without duplicate records", async () => {
  const stored = acceptances([signature(alice)], new Map([[1, "alice"]]), agreement, pull);
  const renamed = { ...alice, login: "alice-renamed" };
  const { github, state, records } = fixture({
    stored,
    authors: [renamed],
    pr: { ...pull, user: renamed },
  });
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("success");
  expect(records()).toHaveLength(1);
  expect(state.head).toBe("existing-head");
});

test("changed agreement text cannot reuse old signatures or old signing comments", async () => {
  const stored = acceptances([signature(alice)], new Map([[1, "alice"]]), agreement, pull);
  const { github, state, records } = fixture({ stored, comments: [signature(alice)] });
  state.text += "A new term.\n";
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("failure");
  const current = agreementFromText(state.text, "example/aulora", "published");
  state.comments.push(signature(alice, current.statement));
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("success");
  expect(records()).toHaveLength(1);
  expect(records(current.hash)).toHaveLength(1);
});

test("commit co-authors on later pages must accept separately, while bot accounts are excluded", async () => {
  const { github, state } = fixture({ comments: [signature(alice)], pages: [[alice, bot], [bob]] });
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("failure");
  expect(state.comments.at(-1).body).toContain("Acceptance needed from @bob");
  state.comments.push(signature(bob));
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("success");
});

test("bot-authored PRs pass without synthetic human signatures", async () => {
  const { github, state } = fixture({ authors: [bot], pr: { ...pull, user: bot } });
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("success");
  expect(state.head).toBeNull();
});

test("unlinked authors fail even when the PR author has signed, and names cannot escape the code block", async () => {
  const { github, state } = fixture({ comments: [signature(alice)], authors: [alice, null] });
  await checkPullRequest(github, repo, "main", 7);
  expect(state.statuses.at(-1).state).toBe("failure");
  expect(state.comments.at(-1).body).toContain("Unlinked \\u0060author\\u0060");
  expect(state.comments.at(-1).body).toContain("no linked GitHub identity");
});

test("concurrent signatures survive a non-fast-forward retry", async () => {
  const stored = acceptances([signature(alice)], new Map([[1, "alice"]]), agreement, pull);
  const { github, state, records } = fixture({ stored });
  const other = { ...bob, id: 4, login: "carol" };
  state.conflict = async () =>
    saveSignatures(
      github,
      repo,
      agreement,
      acceptances([signature(other)], new Map([[4, "carol"]]), agreement, pull),
    );
  await saveSignatures(
    github,
    repo,
    agreement,
    acceptances([signature(bob)], new Map([[2, "bob"]]), agreement, pull),
  );
  expect(
    records()
      .map((record) => record.login)
      .sort(),
  ).toEqual(["alice", "bob", "carol"]);
});

test("API or archive write failure cannot leave a successful CLA status", async () => {
  const { github, state } = fixture({ comments: [signature(alice)] });
  github.rest.git.createRef = async () => {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  };
  await expect(checkPullRequest(github, repo, "main", 7)).rejects.toThrow("Forbidden");
  expect(state.statuses.at(-1).state).toBe("error");
});

test("an agreement changed during a run cannot restore a stale successful status", async () => {
  const { github, state } = fixture({ comments: [signature(alice)] });
  const createComment = github.rest.issues.createComment;
  github.rest.issues.createComment = async (args) => {
    await createComment(args);
    state.text += "Changed while checking.";
  };
  await expect(checkPullRequest(github, repo, "main", 7)).rejects.toThrow("CLA changed");
  expect(state.statuses.at(-1).state).toBe("error");
});

test("changed PR heads and excessive co-author lists fail instead of omitting contributors", async () => {
  for (const changedHead of [true, false]) {
    const { github, state } = fixture();
    const graphql = github.graphql;
    github.graphql = async (...args) => {
      const response = await graphql(...args);
      if (changedHead) response.repository.pullRequest.headRefOid = "new-head";
      else
        response.repository.pullRequest.commits.nodes[0].commit.authors.pageInfo.hasNextPage = true;
      return response;
    };
    await expect(checkPullRequest(github, repo, "main", 7)).rejects.toThrow(
      changedHead ? "PR changed" : "100 co-authors",
    );
    expect(state.statuses.at(-1).state).toBe("error");
  }
});

test("scheduled sweeps reconcile open PRs but ordinary issue comments are ignored", async () => {
  const { github, state } = fixture();
  const core = { error: () => undefined, setFailed: () => undefined };
  const context = {
    repo,
    eventName: "issue_comment",
    payload: { repository: { default_branch: "main" }, issue: { number: 7 } },
  };
  await run({ github, context, core });
  expect(state.statuses).toHaveLength(0);
  context.eventName = "schedule";
  delete context.payload.issue;
  await run({ github, context, core });
  expect(state.statuses.at(-1).state).toBe("failure");
});

test("privileged workflow executes only default-branch code with pinned dependencies", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/cla.yml", import.meta.url),
    "utf8",
  );
  expect(workflow).toMatch(/ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("github.event.pull_request.head");
  expect(workflow).not.toContain("bun install");
  expect(workflow.match(/uses: .*@[a-f0-9]{40}/g)).toHaveLength(2);
});
