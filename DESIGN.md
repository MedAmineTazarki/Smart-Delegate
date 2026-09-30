# Smart Delegate design system

This document guides UI work in the DeepSeek Harness plugin. It takes inspiration from the [Claude DESIGN.md reference](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/claude/DESIGN.md), which analyzes the Claude website rather than the Claude Code application. Adapt its warm, quiet visual language to a dense developer tool; do not copy Claude branding, logos, or marketing layouts.

## Character

- Calm, precise, and readable during long coding sessions.
- Warm neutrals and a restrained coral accent. Status colors communicate state, not decoration.
- Keep the host application's navigation, dialogs, and model selector recognizable. Plugin UI should feel integrated with Harness.
- Use concise labels and practical help text. Make the current provider, model, lane, and connection state obvious.

## Tokens

Use semantic tokens in new plugin CSS. The dark values are the first target because the current Harness web profile uses a dark surface. Light values provide a coherent future theme.

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| Canvas | `#181715` | `#FAF9F5` | Page background |
| Surface | `#252320` | `#F5F0E8` | Cards and modal panels |
| Surface raised | `#302D29` | `#EFE9DE` | Selected rows and popovers |
| Border | `#514B45` | `#DAD3CB` | Hairlines and input outlines |
| Text primary | `#FAF9F5` | `#252523` | Headings and values |
| Text secondary | `#BDB7AF` | `#625E58` | Help text and metadata |
| Accent | `#CC785C` | `#A9583E` | Primary action and focus |
| Accent hover | `#DE8C70` | `#8F462F` | Hovered primary action |
| Success | `#77C38D` | `#286C40` | Connected and ready |
| Warning | `#E8B56A` | `#8A5D18` | Sign-in or key needed |
| Error | `#E88983` | `#A83832` | Failed connection or validation |

Prefer Harness semantic CSS variables for text, borders, and status where they already exist. Use the values above as plugin fallbacks. Do not recolor unrelated host components with broad selectors.

## Type and spacing

- Interface text: system sans (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`). Use the host font when inherited.
- Code, provider IDs, model IDs, and authorization codes: `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Page title: 21–24 px, medium weight. Section title: 15–16 px, semibold. Body: 13–14 px. Help text: 12 px. Avoid tiny text for essential controls.
- Spacing scale: 4, 8, 12, 16, 24, 32 px. Use 8–12 px within rows, 16–24 px within cards, and 24–32 px between sections.
- Radius scale: 6 px for inputs and buttons, 10 px for cards, 12 px for modals, full radius for status pills.

## Components

- **Settings navigation:** one clear active item. Keep Providers as the single place to manage provider connections and their models.
- **Provider card:** show name, connection method, and a visible Ready / Needs attention state in the closed row. Expanding reveals connection actions and a searchable model list.
- **Model row:** show the human-readable name and exact model ID. Keep the enable switch aligned consistently. Never rely on color alone for state.
- **Lane editor:** group responsibility, task types, target, and limits in that order. Make disabled and unavailable targets explicit.
- **Primary button:** reserve coral for the main action of a panel. Secondary actions use a quiet outline or text button. Destructive actions use the error color and a clear label.
- **Input and search:** 36–40 px minimum height, visible border, descriptive label, and a strong focus ring. Place validation next to the field.
- **Modal:** one clear title, short explanation, scrollable content, and actions visible at the bottom. Close with Escape and restore focus to the trigger.
- **Status:** pair a dot or icon with text such as `Ready`, `Signed out`, or `API key needed`.

## Interaction and layout

- Keep content widths readable: about 720 px for provider lists and 860 px for the delegation page.
- On narrow windows, stack label/control grids and keep search and actions reachable without horizontal scrolling.
- Maintain at least 44 px hit targets for major actions where space allows. Always show keyboard focus.
- Announce save, connection, and validation outcomes through visible text and appropriate live regions.
- Motion should be subtle and respect `prefers-reduced-motion`.

## Implementation notes

- New Smart Delegate UI lives in `harness/client.js`; scope styles under `.sd-*` classes and consolidate repeated values into semantic custom properties when updating the CSS.
- The native Harness shell owns its own theme and components. Test dark and light appearance before overriding host styles.
- Check the Providers, Delegation, connection modal, model toggles, keyboard focus, and a narrow viewport after visual changes.
- The current Harness client theme and Smart Delegate pages implement the dark and light palettes above. Keep this file and the theme rules in `harness/client.js` aligned when changing tokens.
