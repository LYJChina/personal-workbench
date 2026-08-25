# AI Persona and Profile Context Design

## Goal

Make the dashboard AI assistant feel personal and stable without coupling the core to one model provider. The user's saved profile produces an editable personal portrait. The assistant has a configurable name, personality, and custom instructions. A final editable system prompt is injected into each model request without being stored as a visible chat message.

## Scope

This change includes:

- synchronizing the saved profile name into the desktop sidebar brand;
- generating, viewing, editing, saving, and regenerating a personal portrait from all textual profile fields;
- configuring the assistant name, personality, custom instructions, and final system prompt;
- optionally asking the configured model to merge those prompt sources;
- injecting the saved final prompt into dashboard AI requests;
- displaying the configured assistant name throughout the chat card;
- retaining the existing one-click `新对话` conversation clearing behavior;
- stabilizing the chat layout so completed replies appear as one message without moving the surrounding dashboard.

Automatic long-term conversation summarization and multiple independent conversations are not part of this increment.

## Data Model

Add a single local AI persona record with these fields:

- `assistant_name`: the display name used by the dashboard chat;
- `personality`: the user's description of the assistant's tone and behavior;
- `profile_portrait`: an editable summary derived from the profile;
- `profile_portrait_source_updated_at`: the profile revision used for the latest generation;
- `custom_instructions`: additional user-authored instructions;
- `system_prompt`: the final editable prompt injected into model requests;
- `system_prompt_mode`: `generated` or `manual`, used to explain how the current prompt was produced;
- generation and update timestamps.

All fields live in the existing portable SQLite database. They contain no API keys. API keys remain in the encrypted secret store.

The profile record gains a reliable update revision or timestamp so the UI can mark the portrait as possibly outdated after profile text changes. Changing only the photo does not make the text portrait stale.

## Profile and Sidebar Synchronization

The sidebar brand currently displays a hard-coded `LYJ`. It will instead consume the same profile state as the profile card. After a successful profile save, the application-level profile state updates immediately, causing both the card and sidebar name to update without a reload.

If the name is empty, the sidebar uses the existing neutral fallback. The product subtitle remains unchanged.

## Personal Portrait Generation

The profile editor adds an `更新个人画像` action. The action first saves all textual profile fields, then sends a purpose-built prompt through the current default AI gateway. The input includes the name, birthday, employee number, and every custom field label and value. Empty fields are omitted.

The model is instructed to summarize only supplied facts, avoid guessing sensitive attributes, and produce a concise description suitable for assistant context. The generated portrait is saved locally and shown in an editable text area.

The user can:

- inspect and edit the portrait;
- save manual edits without calling an API;
- regenerate it from the latest profile;
- confirm before regeneration when saved manual changes would be replaced.

When profile text changes after portrait generation, the UI shows that the portrait may be outdated. It does not automatically call the model or overwrite the portrait.

If generation fails, the newly edited profile remains saved, the previous portrait remains unchanged, and the UI shows a sanitized error.

## Assistant Settings

The chat card receives a settings button that opens a focused assistant settings panel. It contains:

- assistant name;
- personality and response style;
- editable personal portrait with regenerate action;
- editable custom instructions;
- editable final system prompt;
- `AI 智能融合`, `保存`, and `恢复默认` actions.

`AI 智能融合` sends the current portrait, personality, and custom instructions to the default model and asks it to create one coherent system prompt. The returned text is placed in the final prompt editor for review and is saved only when the user confirms. This avoids silently replacing a hand-edited prompt.

Direct edits to the final prompt switch its mode to `manual`. Regenerating the portrait does not automatically overwrite the final prompt; instead, the interface marks the final prompt as potentially outdated and offers fusion again.

`恢复默认` restores a safe local template after confirmation. It does not call the model and does not delete the portrait or custom instructions.

## Prompt Assembly and Provider Independence

For every dashboard chat request, the server constructs the provider-neutral message list in this order:

1. the saved final system prompt, when non-empty;
2. bounded prior user and assistant messages;
3. the current user message.

The system prompt is stored once in the persona record and is not inserted into `ai_chat_messages`. It is carried on each stateless provider request because OpenAI-compatible Chat Completions and the Anthropic adapter do not guarantee server-side conversation memory.

The implementation remains behind the existing AI gateway so OpenAI-compatible and Anthropic-native connections receive equivalent behavior. Prompt generation and fusion use the current default connection and the existing sanitized gateway errors.

## Chat Interface

With assistant name `小杰`, the card title becomes `问问小杰`, assistant message labels become `小杰`, and loading or confirmation text may reference `小杰`. Empty names are rejected; a safe default name is used for existing databases.

The existing `新对话` button remains the one-click conversation clearing action. It continues to ask for confirmation when messages exist, deletes only chat messages, and keeps the persona, system prompt, profile, and provider settings.

The chat card and message log receive stable dimensions. Messages scroll inside the log rather than increasing the dashboard card height. While a request is pending, a fixed-size thinking placeholder reserves the reply area. The completed assistant response replaces that placeholder in one render; there is no typewriter or token-by-token layout expansion. The log scrolls internally to the newest content without moving the dashboard page.

## API Boundaries

Add local endpoints for:

- reading and updating assistant persona settings;
- generating or regenerating the personal portrait;
- fusing prompt sources into a candidate final prompt.

Generation endpoints return candidate text or a saved portrait as appropriate, never API keys or raw upstream error bodies. Inputs use strict schemas, bounded text sizes, and reject unknown fields. Request cancellation follows the existing request lifecycle.

The existing profile update response remains the authoritative profile value. The web application shares that value with the sidebar instead of issuing duplicate profile writes.

## Error and Safety Behavior

- Profile saving and portrait generation are separate persistence steps so a provider failure never rolls back valid profile edits.
- AI fusion returns a candidate and never overwrites the saved final prompt without an explicit save.
- Regeneration confirms before replacing an edited portrait.
- All prompt inputs and outputs have explicit size limits to protect the local database and provider request budget.
- Provider, database, and validation errors use fixed user-facing messages and do not expose secrets or local paths.
- Clearing a conversation never clears persona settings.

## Testing

Server tests cover:

- persona record migration and defaults;
- portrait editing, generation, stale detection, and failure preservation;
- prompt fusion returning a candidate without implicit overwrite;
- system prompt ordering and injection into both provider protocols;
- absence of system prompts from visible chat history;
- conversation clearing preserving persona settings;
- input limits, cancellation, and sanitized errors.

Web tests cover:

- profile name updating both the card and sidebar immediately;
- portrait viewing, editing, saving, regeneration confirmation, and stale state;
- assistant settings load, edit, fusion review, manual save, and default restoration;
- configured assistant name in the title and message labels;
- existing `新对话` behavior;
- fixed chat geometry and replacement of the thinking placeholder by a complete response.

Full contract, server, web, type-check, and production-build verification remains required before completion.
