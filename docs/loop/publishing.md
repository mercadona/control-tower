# How a change reaches a session

Written because the question that leads here is always the same one: *I merged
it, why is it not running?* Every step below has been measured, and two of them
are the ones that actually catch people.

## The chain

1. **A pull request merges into `main`.** Its **title** becomes the commit
   subject, because this repository squashes and `squash_merge_commit_title` is
   `PR_TITLE`. What you wrote in the branch never arrives.
2. **That title carries a conventional-commit type** — `feat`, `fix`, `docs`,
   `test`… — or release-please does not see the commit at all. Not an error
   anywhere: just silence. `docs/pull-request-titles.md` has the table of types.
3. **release-please updates one open pull request** with the three changelogs
   and the three versions already bumped. It runs on every push to `main` and
   the pull request waits there, accumulating, until somebody merges it.
4. **Somebody merges it.** That merge is what creates the tags and the GitHub
   releases. It is a human gate, like the loop's other three: publishing is a
   decision, not a consequence.
5. **A session re-fetches the plugin** — and only then does the change exist for
   anybody else.

## The first thing that catches people: the release pull request looks unchecked

`ci` is a required check of `main`, and that pull request is opened by
`github-actions[bot]`. A workflow run triggered by an event the default
`GITHUB_TOKEN` created is **held at `action_required`** until a person approves
it, and `gh pr checks` prints nothing at all for a run in that state. From
outside it looks exactly like "CI does not run here". It runs. It is waiting.

Approve the run of its current head and it goes green on its own:

```sh
id=$(gh api repos/mercadona/control-tower/actions/runs \
  --jq '[.workflow_runs[]|select(.head_branch=="release-please--branches--main"
         and .conclusion=="action_required")][0].id')
gh api --method POST repos/mercadona/control-tower/actions/runs/$id/approve
```

Closing and reopening the pull request also works — a person reopening it is not
the bot — but only until the next push to `main`, which gives it a new head and
a new held run. The merge queue does **not** exempt it: enqueueing without `ci`
is refused with `Required status check "ci" is expected`.

Why this is not automated with a PAT, which would remove the step entirely: the
trade is one command every few weeks against a long-lived credential living in a
public repository. It was weighed and refused; `release-please.yml` carries the
reasoning.

## The second thing: your own machine may not be able to tell you

**The plugin's cache is keyed by version.** While
`plugin/.claude-plugin/plugin.json` says the same number, nothing is re-fetched
— so an unpublished change reaches nobody, and the symptom is that everything
looks normal.

And the person developing the plugin is the one who cannot notice, because their
machine usually bypasses the whole chain. Check which kind of install you have
before trusting what you see:

```sh
python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.claude/plugins/known_marketplaces.json')));print(d['control-tower']['source'])"
```

- `"source": "directory"` — your sessions read that **checkout**, live. A pull
  changes your behaviour and no publication is involved. Useful for developing,
  useless as evidence that publishing works.
- `"source": "github"` — your sessions read a **published version**. This is the
  install the chain above is about.

`installed_plugins.json` is not evidence on a `directory` install. Measured on
the development machine on 2026-09-20: it named `0.34.0` from 7 August, pointing
at a frozen cache directory with five commands and no agents, while the session
reading it had twelve skills and four agents. It was describing an install that
had not executed for six weeks.

## What to check when your change is not running

| Question | How to answer it |
|---|---|
| Did the title carry a type? | `git log --oneline -1 <your merge>` — the subject is the title |
| Did release-please see it? | its pull request's changelog names the commit, or it does not |
| Is its run held? | `gh pr checks` printing nothing is the tell, not an absence of runs |
| Was it published? | `gh api repos/mercadona/control-tower/releases --jq '.[0].tag_name'` |
| Does your machine even use versions? | the marketplace source, above |
