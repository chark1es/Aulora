# CLA bot

The [workflow](../.github/workflows/cla.yml) checks the pull request author and every commit author and co-author against the published [CLA](../CLA.md). GitHub bot accounts are excluded. Human maintainers must accept the agreement like other contributors.

## Accept an agreement

Open a pull request and follow the bot's comment. Read its link to the agreement, then copy the exact statement into a new comment from your own GitHub account. Every listed contributor accepts separately. The statement includes the agreement revision and SHA-256, so an old comment cannot sign a changed agreement.

The bot uses the agreement on the repository's default branch, not a proposed version in a pull request. Acceptance applies to later contributions under that exact text. Employer authorization remains the contributor's responsibility as described in the CLA.

## Tracking records

On the first acceptance, the bot creates an independent `cla-signatures` branch containing only agreement archives and records. Each agreement has these files:

```text
agreements/<sha256>/CLA.md
agreements/<sha256>/signatures.json
```

Each record contains the GitHub account ID and username, acceptance timestamp and statement, agreement revision/hash and immutable source URL, and pull request/comment references. Account IDs keep acceptance valid after a username change. The archive preserves the text and acceptance even if the comment is later edited or deleted. Records have the same visibility as the repository; do not include private employer documents in signing comments.

The bot appends records through Git commits and retries conflicting branch updates. It never force-pushes. Keep the archive branch and its history backed up. Restrict direct changes to trusted maintainers while permitting the GitHub Actions token to append records. Do not require pull requests or status checks for writes to that branch.

## Enable the check

Merge the workflow and script to the default branch. The bot uses the built-in `GITHUB_TOKEN`; there is no service account, personal access token, external app, or additional secret to configure. Repository or organization policies must permit the workflow's contents, issues, and statuses write permissions.

Run **Actions → CLA bot → Run workflow** on the default branch to check existing open pull requests. Leave the PR number empty to check them all. Once the status appears, require **CLA**, provided by GitHub Actions, alongside **Required checks** in the branch protection rule or ruleset for `main`. Require branches to be up to date. The `CLA` commit status is the merge gate; the workflow job's result is not a substitute.

This workflow checks pull requests, not merge-group commits. Add merge-group handling before using the `CLA` requirement with a GitHub merge queue.

## Recheck and troubleshoot

PR opening, reopening, new commits, and comment changes trigger a check. Comment `recheck` to retry after linking a commit identity or resolving an error. A manual workflow run and an hourly sweep also reconcile open PRs. These sweeps recover comment events that GitHub's concurrency queue may replace.

If an author is unlinked, that person must add and verify the commit email on their GitHub account, then request a recheck. Correct inaccurate commit author or co-author attribution in the branch. The check stays unsuccessful while any author is unidentified. Commits with more than 100 co-authors must be split before checking.

If the status reports an error, inspect the CLA workflow logs. Missing write permissions, archive branch protections, API failures, or an invalid agreement revision cause an error rather than a passing status. A failure to save acceptance cannot pass the check.

## Change the agreement

Update the `Agreement revision:` line when editing the agreement. The hash changes with any text change, even if the revision label is accidentally left unchanged. Existing records remain archived, and contributors accept the new text on their next open PR. A push changing `CLA.md` on `main` rechecks all open PRs; the hourly sweep also catches changes published through other means.

The workflow runs trusted default-branch code and reads PR metadata through the GitHub API. It never checks out or executes contributor code in the job with write permissions. Dependencies are pinned by commit. Keep this boundary when maintaining the bot. See [GitHub's guidance on pull request target events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target).
