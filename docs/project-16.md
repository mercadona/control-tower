<!-- Moved out of `CLAUDE.md` and `AGENTS.md` so those fit the 150 lines they
ask for, and corrected on the way: the second command those documents carried
does not exist in the `gh` this repository is used with. The rule — an issue
enters the Project before any file is edited for it — stays there. -->

# Putting an issue into Project 16

Before editing files or running an implementation command for a GitHub issue,
add its canonical URL to Project 16 and set its item status to `In Progress`.
Move it to `In Review` when the pull request opens and to `Done` when it merges.

```sh
gh project item-add 16 --owner mercadona --url "<issue URL>" --format json --jq .id
```

The add is safe if the auto-add workflow already added the item, and it answers
with the item id the next command needs.

## Why the second command is not the one you would guess

`gh project item-edit` takes **ids, not names**. The shape
`item-edit 16 --owner mercadona --url … --field "Status" --value "In Progress"`
reads plausibly, is what these instructions carried for months, and fails: that
command has no `--field`, no `--value` and no `--url`. What it wants:

```sh
gh project item-edit \
  --project-id PVT_kwDOAWpAt84Bi_og \
  --id "<item id from the add above>" \
  --field-id PVTSSF_lADOAWpAt84Bi_ogzhh1ojM \
  --single-select-option-id <option> --format json
```

| Status | `--single-select-option-id` |
|---|---|
| `Backlog` | `f75ad846` |
| `In Progress` | `47fc9ee4` |
| `In Review` | `10383db9` |
| `Done` | `98236657` |

To find an item id again later, list the project rather than guessing:

```sh
gh project item-list 16 --owner mercadona --format json --limit 300 \
  --jq '.items[] | select((.content.number // 0) == <issue>) | .id'
```

If any of this fails, stop before implementation and report the Project error.
