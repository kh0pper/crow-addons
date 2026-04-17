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

### Local LLM inference (Strix Halo + NVIDIA)

Bundles below run local LLMs via llama.cpp (Vulkan AMDVLK) or vLLM (ROCm/CUDA). Most bundles require a pre-downloaded GGUF/HF model; see each bundle's `docker-compose.yml` comments for the exact `curl` command. All reference shared env files at `~/.crow/env/rocm.env` or `~/.crow/env/cuda.env` (operator-maintained; see the `crow` main repo CLAUDE.md § "Adding a new bundle add-on").

| Add-on | Hardware | Description |
|--------|----------|-------------|
| [llamacpp-vulkan-qwen36-35b-a3b](llamacpp-vulkan-qwen36-35b-a3b/) | AMD Strix Halo gfx1151 | Qwen3.6-35B-A3B (35B/3B active MoE) UD-Q6_K + mmproj-F16 vision encoder; agentic coding + VLM. Apr 2026. |
| [llamacpp-vulkan-qwen3-coder](llamacpp-vulkan-qwen3-coder/) | AMD Strix Halo gfx1151 | Qwen3-Coder-30B-A3B Q8_0 MoE, on-demand code specialist. |
| [llamacpp-vulkan-glm-45-air](llamacpp-vulkan-glm-45-air/) | AMD Strix Halo gfx1151 | GLM-4.5-Air 106B/12B MoE Q5_K_M, deep-reasoning specialist. |
| [llamacpp-qwen72b](llamacpp-qwen72b/) | AMD Strix Halo gfx1151 | Qwen 72B via llama.cpp. |
| [vllm-rocm-qwen3](vllm-rocm-qwen3/) | AMD Strix Halo gfx1151 | Qwen3-4B via vLLM-ROCm, fast dispatch model. |
| [vllm-rocm-qwen3-32b](vllm-rocm-qwen3-32b/) | AMD Strix Halo gfx1151 | Qwen3-32B via vLLM-ROCm, daily-driver mid-tier. |
| [vllm-rocm-qwen35-4b](vllm-rocm-qwen35-4b/) | AMD Strix Halo gfx1151 | Qwen3.5-4B via vLLM-ROCm. |
| [vllm-rocm-qwen35-27b](vllm-rocm-qwen35-27b/) | AMD Strix Halo gfx1151 | Qwen3.5-27B via vLLM-ROCm. |
| [vllm-rocm-kimi](vllm-rocm-kimi/) | AMD Strix Halo gfx1151 | Kimi model via vLLM-ROCm. |
| [vllm-cuda-embed](vllm-cuda-embed/) | NVIDIA CUDA | Qwen3-Embedding-0.6B BF16 for semantic memory/search. |
| [vllm-cuda-rerank](vllm-cuda-rerank/) | NVIDIA CUDA | Qwen3-Reranker-0.6B BF16 cross-encoder for top-K reranking. |
| [vllm-cuda-vision](vllm-cuda-vision/) | NVIDIA CUDA | Qwen3-VL-4B-Instruct-FP8 vision-language model. |

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
