# Google Workspace

You can read and act on the user's own Google Workspace through 57 MCP tools
backed by the user's OAuth credentials. Everything runs locally; no Workspace data
leaves the machine except what is sent to the AI model the user has chosen.

## What you can do

- **Drive** (`gdrive_*`): search, list folders, read metadata, create folders, move files.
- **Docs** (`gdocs_*`): read, read a section, get the heading structure, find/replace,
  append, insert at a heading, replace a section, create docs, and manage comments
  (list/add/reply/resolve). There is deliberately **no whole-document replace** — edits
  are surgical to protect formatting.
- **Sheets** (`sheets_*`): list tabs, read a range, write a range, append rows.
- **Slides** (`gslides_*`): read decks and notes, create decks, add/duplicate/delete/
  reorder slides, add text boxes and images, format text/paragraphs, find/replace, export.
- **Gmail** (`gmail_*`): search and read threads, create drafts and threaded replies,
  manage labels and filters. Drafts are never auto-sent. The only tool that actually
  sends, `gmail_send_to_self`, is restricted to an allowlist that is empty by default
  (set `GMAIL_SEND_TO_SELF_ALLOWLIST`).
- **Calendar** (`gcal_*`): list calendars, list/read/create events, respond to invites.

## Safety

- Prefer creating **drafts** over sending. Never send email to external recipients.
- Confirm before destructive actions (deleting/overwriting content, resolving comments).
- For students' or other protected data, remember that data only stays private when the
  user runs a **local** model — surface that distinction if the user pairs this with a
  cloud model.

## Setup (one time)

If a tool reports "Not authenticated", the user must authorize first:
1. Create a Google Cloud OAuth client (**Desktop** type) with the Drive, Docs, Sheets,
   Slides, Gmail, and Calendar APIs enabled; download `credentials.json` to
   `~/.config/google-workspace-mcp/`.
2. Run `uvx --from git+https://github.com/kh0pper/google-workspace-mcp google-workspace-mcp-authorize --manual`
   and follow the copy-paste prompts.

Full guide (including access tiers for locked-down school districts and FERPA notes):
https://github.com/kh0pper/google-workspace-mcp
