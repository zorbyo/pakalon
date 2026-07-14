# `/directory` — Add directories to the workspace

Pick one or more directories to add to the current session. The
agent's tools (read, search, etc.) operate on the union of the
current cwd and the added dirs.

## Arguments

- `$ARGUMENTS` — optional. A space-separated list of absolute
  directory paths; otherwise the directory picker opens.

## Steps

1. Open a multi-select TUI picker rooted at the current cwd.
2. On confirm, update the session's `extraDirs` list.
3. The agent can now `read`/`search`/`edit` files under the added
  directories.
