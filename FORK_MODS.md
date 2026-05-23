# Fork Mods

This file tracks local changes that are intentionally kept on top of upstream T3 Code.

When changing fork-local behavior:

- Wrap code with `T3CODE-FORK-MOD-BEGIN <id>` and `T3CODE-FORK-MOD-END <id>` comments where practical.
- Keep each mod small enough to rebase or port during upstream updates.
- Update this file when a mod is added, removed, or materially changed.

## Active Mods

| ID                            | Area                                                        | Purpose                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `fork/custom-theme`           | `apps/web` theme hook, settings UI, CSS tokens, boot script | Adds personal custom color controls for primary text, chat text, and tool rendering text.                                       |
| `fork/chat-code-highlighting` | `apps/web` markdown rendering and diff highlighting support | Uses a local Shiki theme, highlights inline code, and renders user messages as markdown when no terminal contexts are attached. |
| `fork/tool-text-tone`         | `apps/web` message timeline                                 | Routes tool-call row text through a custom color token so tool output can be themed independently.                              |
