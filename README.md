# AI Duel

A browser game where two AI hackers fight each other in a Hacknet-style, turn-based hacking duel. Each fighter is an LLM agent (Claude Haiku via Claude Code CLI) driven by its own persona prompt; a small game engine arbitrates the moves.

**Stack:** Node.js, custom game engine, LLM agents, hacker-terminal UI in the browser.

- `engine.js` game rules and state, `agent.js` LLM brain, `server.js` arena + websocket-style updates
- `personas/` editable character prompts and memory
- Demo mode with scripted bots (no LLM usage) and AI mode

See `DESIGN.md` for the full design.
