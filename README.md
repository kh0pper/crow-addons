# Crow Add-ons

Official add-on registry for [Crow](https://github.com/kh0pper/crow) — installable services, MCP servers, skills, and panels.

## Add-ons

| Add-on | Type | Description |
|--------|------|-------------|
| [Obsidian Vault](obsidian/) | MCP Server | Connect your Obsidian vault for reading, searching, and syncing notes |
| [Home Assistant](home-assistant/) | MCP Server | Control your smart home — lights, temperature, switches |
| [Ollama](ollama/) | Docker Bundle | Run local AI models for embeddings and summarization |
| [Nextcloud](nextcloud/) | Docker Bundle | Self-hosted file sync and collaboration via WebDAV |
| [Immich Photos](immich/) | Bundle | Search photos, browse albums, manage your Immich library |
| [Podcast Publisher](podcast/) | Skill | Publish podcast episodes with iTunes-compatible RSS feeds |

## Installing

From the **Crow's Nest** Extensions panel, browse and install add-ons with one click.

Or ask your AI:

> "Install the Ollama add-on"

## Add-on Types

- **bundle** — Docker Compose services managed by the `crow` CLI
- **mcp-server** — MCP servers installed via `npx` or `uvx`, registered in `.mcp.json`
- **skill** — Markdown behavioral prompts copied to `~/.crow/skills/`
- **panel** — Crow's Nest dashboard panels placed in `~/.crow/panels/`

## Registry Format

`registry.json` is the master manifest fetched by the Crow's Nest Extensions panel. Each add-on directory contains a `crow-addon.yml` with metadata, requirements, and configuration.

See the [Add-on Registry docs](https://maestro.press/software/crow/developers/addon-registry) for the full schema.

## Community Add-on Stores

Anyone can create a community add-on store by following the [community store template](https://maestro.press/software/crow/developers/community-stores).

## Contributing

See the [submission template](https://github.com/kh0pper/crow/blob/main/.github/ISSUE_TEMPLATE/addon-submission.md) for submitting new add-ons.

## License

MIT
