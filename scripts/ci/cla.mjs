import { createHash } from "node:crypto";

const branch = "cla-signatures";
const marker = "<!-- aulora-cla-bot -->";
const statusContext = "CLA";

export function agreementFromText(text, repository, sha) {
  const revision = text.match(/^Agreement revision: ([\w.-]+)\.$/m)?.[1];
  if (!revision) throw new Error("CLA.md must declare an agreement revision.");
  const hash = createHash("sha256").update(text).digest("hex");
  return {
    text,
    revision,
    hash,
    url: `https://github.com/${repository}/blob/${sha}/CLA.md`,
    guideUrl: `https://github.com/${repository}/blob/HEAD/docs/cla-bot.md`,
    statement: `I have read and agree to the Aulora Contributor License Agreement, revision ${revision}, SHA-256 ${hash}. I have the authority to make its grants for my contributions.`,
  };
}

function isBot(user) {
  return user.type === "Bot" || user.login.endsWith("[bot]");
}

async function readFile(github, repo, path, ref) {
  const { data } = await github.rest.repos.getContent({ ...repo, path, ref });
  if (data.type !== "file" || data.encoding !== "base64") {
    throw new Error(`Cannot read ${path} as a regular file.`);
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}

async function readAgreement(github, repo, defaultBranch) {
  const { data } = await github.rest.git.getRef({ ...repo, ref: `heads/${defaultBranch}` });
  const sha = data.object.sha;
  return agreementFromText(
    await readFile(github, repo, "CLA.md", sha),
    `${repo.owner}/${repo.repo}`,
    sha,
  );
}

async function archiveHead(github, repo) {
  try {
    return (await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` })).data.object.sha;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function readSignatures(github, repo, agreement, head) {
  if (!head) return [];
  try {
    return JSON.parse(
      await readFile(github, repo, `agreements/${agreement.hash}/signatures.json`, head),
    );
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

// Commit the document and records together. A non-fast-forward update retries
// against the new archive head, preserving signatures from concurrent PRs.
export async function saveSignatures(github, repo, agreement, additions) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const head = await archiveHead(github, repo);
    const existing = await readSignatures(github, repo, agreement, head);
    const identities = new Set(existing.map((record) => record.userId));
    const records = additions.filter((record) => !identities.has(record.userId));
    if (!records.length) return;
    const baseTree = head
      ? (await github.rest.git.getCommit({ ...repo, commit_sha: head })).data.tree.sha
      : undefined;
    const { data: tree } = await github.rest.git.createTree({
      ...repo,
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: [
        {
          path: `agreements/${agreement.hash}/CLA.md`,
          mode: "100644",
          type: "blob",
          content: agreement.text,
        },
        {
          path: `agreements/${agreement.hash}/signatures.json`,
          mode: "100644",
          type: "blob",
          content: `${JSON.stringify([...existing, ...records], null, 2)}\n`,
        },
      ],
    });
    const { data: commit } = await github.rest.git.createCommit({
      ...repo,
      message: `chore(cla): record acceptance for ${records.map((record) => record.login).join(", ")}`,
      tree: tree.sha,
      parents: head ? [head] : [],
    });
    try {
      if (head) {
        await github.rest.git.updateRef({
          ...repo,
          ref: `heads/${branch}`,
          sha: commit.sha,
          force: false,
        });
      } else {
        await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: commit.sha });
      }
      return;
    } catch (error) {
      if (![409, 422].includes(error.status) || attempt === 4) throw error;
    }
  }
}

async function contributors(github, repo, pull) {
  const people = new Map();
  const unknown = new Set();
  if (!isBot(pull.user)) people.set(pull.user.id, pull.user.login);
  let cursor = null;
  do {
    const { repository } = await github.graphql(
      `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            headRefOid
            commits(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes { commit {
                oid
                authors(first: 100) {
                  pageInfo { hasNextPage }
                  nodes { name user { databaseId login } }
                }
              } }
            }
          }
        }
      }`,
      { ...repo, number: pull.number, cursor },
    );
    const current = repository.pullRequest;
    if (current.headRefOid !== pull.head.sha) {
      throw new Error("The PR changed during the CLA check; recheck the current head.");
    }
    for (const { commit } of current.commits.nodes) {
      if (commit.authors.pageInfo.hasNextPage) {
        throw new Error(
          "A commit has more than 100 co-authors. Split it before rechecking the CLA.",
        );
      }
      for (const actor of commit.authors.nodes) {
        if (!actor.user?.databaseId) {
          unknown.add(`${actor.name || "Unlinked author"} (${commit.oid.slice(0, 7)})`);
        } else if (!isBot(actor.user)) {
          people.set(actor.user.databaseId, actor.user.login);
        }
      }
    }
    cursor = current.commits.pageInfo.hasNextPage ? current.commits.pageInfo.endCursor : null;
  } while (cursor);
  return { people, unknown: [...unknown] };
}

export function acceptances(comments, people, agreement, pull) {
  const records = new Map();
  for (const comment of comments) {
    if (
      !people.has(comment.user.id) ||
      isBot(comment.user) ||
      comment.body?.trim() !== agreement.statement
    ) {
      continue;
    }
    if (records.has(comment.user.id)) continue;
    records.set(comment.user.id, {
      userId: comment.user.id,
      login: comment.user.login,
      acceptedAt: comment.updated_at,
      statement: agreement.statement,
      revision: agreement.revision,
      agreementHash: agreement.hash,
      agreementUrl: agreement.url,
      pullRequest: pull.html_url,
      commentId: comment.id,
      commentUrl: comment.html_url,
    });
  }
  return [...records.values()];
}

function commentBody(agreement, missing, unknown) {
  const lines = [marker, "## Contributor agreement", ""];
  if (!missing.length && !unknown.length) {
    lines.push(
      `All contributors have accepted [CLA revision ${agreement.revision}](${agreement.url}).`,
    );
  } else {
    if (missing.length) {
      lines.push(`Acceptance needed from ${missing.map((login) => `@${login}`).join(", ")}.`, "");
    }
    lines.push(
      `Read [CLA revision ${agreement.revision}](${agreement.url}), then post this exact statement as a new comment from your own account:`,
      "",
      "```text",
      agreement.statement,
      "```",
      "",
      "Acceptance is recorded once per agreement text and reused on later pull requests.",
    );
    if (unknown.length) {
      // Commit metadata is untrusted text. JSON inside a fenced block avoids
      // turning names into mentions, links, or bot instructions.
      lines.push(
        "",
        "These commit authors have no linked GitHub identity:",
        "",
        "```json",
        JSON.stringify(unknown).replaceAll("`", "\\u0060"),
        "```",
        "",
        "Link the commit email to the author's GitHub account, then comment `recheck`. Correct incorrect author attribution before rechecking.",
      );
    }
  }
  lines.push("", `[Tracking and troubleshooting](${agreement.guideUrl}).`);
  return lines.join("\n");
}

export async function checkPullRequest(github, repo, defaultBranch, number) {
  const { data: pull } = await github.rest.pulls.get({ ...repo, pull_number: number });
  if (pull.state !== "open") return;
  const status = (state, description) =>
    github.rest.repos.createCommitStatus({
      ...repo,
      sha: pull.head.sha,
      context: statusContext,
      target_url: pull.html_url,
      state,
      description,
    });
  await status("pending", "Checking contributor agreement acceptance.");
  try {
    const agreement = await readAgreement(github, repo, defaultBranch);
    const { people, unknown } = await contributors(github, repo, pull);
    const comments = await github.paginate(github.rest.issues.listComments, {
      ...repo,
      issue_number: number,
      per_page: 100,
    });
    const stored = await readSignatures(github, repo, agreement, await archiveHead(github, repo));
    const acceptedIds = new Set(stored.map((record) => record.userId));
    const additions = acceptances(comments, people, agreement, pull).filter(
      (record) => !acceptedIds.has(record.userId),
    );
    if (additions.length) await saveSignatures(github, repo, agreement, additions);
    for (const record of additions) acceptedIds.add(record.userId);
    const missing = [...people].filter(([id]) => !acceptedIds.has(id)).map(([, login]) => login);
    const body = commentBody(agreement, missing, unknown);
    const previous = comments.find(
      (comment) => comment.user.login === "github-actions[bot]" && comment.body?.startsWith(marker),
    );
    if (!previous) {
      await github.rest.issues.createComment({ ...repo, issue_number: number, body });
    } else if (previous.body !== body) {
      await github.rest.issues.updateComment({ ...repo, comment_id: previous.id, body });
    }
    // Do not let an older run restore success after the published CLA changes.
    const latest = await readAgreement(github, repo, defaultBranch);
    if (latest.hash !== agreement.hash)
      throw new Error("The CLA changed during this check. Recheck.");
    await status(
      missing.length || unknown.length ? "failure" : "success",
      unknown.length
        ? "Commit authors need linked GitHub identities. See the bot comment."
        : missing.length
          ? `${missing.length} contributor(s) must accept the CLA. See the bot comment.`
          : "All contributors have accepted the current CLA.",
    );
  } catch (error) {
    await status("error", "CLA check could not complete. See the workflow logs and recheck.");
    throw error;
  }
}

export async function run({ github, context, core }) {
  const repo = context.repo;
  const defaultBranch = context.payload.repository.default_branch;
  const number =
    context.payload.pull_request?.number ??
    context.payload.issue?.number ??
    context.payload.inputs?.pull_request;
  if (context.eventName === "issue_comment" && !context.payload.issue?.pull_request) return;
  const pulls = number
    ? [{ number: Number(number) }]
    : await github.paginate(github.rest.pulls.list, { ...repo, state: "open", per_page: 100 });
  for (const pull of pulls) {
    try {
      await checkPullRequest(github, repo, defaultBranch, pull.number);
    } catch (error) {
      core.error(`PR #${pull.number}: ${error.message}`);
      core.setFailed("One or more CLA checks could not complete.");
    }
  }
}
