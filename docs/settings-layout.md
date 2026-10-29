# Settings page template

Every settings page uses `components/SettingsLayout.tsx`. System, models and
usage statistics are the reference consumers. Add future pages to the same
template rather than copying page headers or defining another content width.

| Element | Shared rule |
| --- | --- |
| Page container | Centered, maximum 896px including horizontal padding |
| Page padding | 48px vertically / 32px horizontally; 32px / 20px in narrow content areas |
| Page title | 24px, weight 600, 30px line height |
| Page description | 13px, 20px line height, 8px below title |
| Header-to-content gap | 36px |
| Section title | 14px, weight 600, 20px line height |
| Section-to-content gap | 12px |
| Section spacing | 28px |
| Cards | Theme border and panel background, 9px radius |
| Controls | Shared 6px radius; switches and other purpose-specific shapes retain their shape |

- `SettingsLayout` owns the sole scrolling container, title, description,
  optional header actions, responsive padding, width and settings-only radius
  variables. Do not put another page-sized scroll container inside it.
- `SettingsSection` supplies section headings, optional descriptions and counts.
- `SettingsCard` supplies the common card surface. Callers may set inner padding
  and content layout, but must not override the border radius or page dimensions.
- `SettingsRow` supplies consistent labels, descriptions, control alignment and
  wrapping. A group of rows can use `SettingsCard` with `divide-y` and `px-4`.
- Page-specific data, charts, forms and connection logic stay in their existing
  components. Tables and charts can scroll horizontally inside a card when needed.
- Changes to the shared style rules belong in the template. The app shell,
  settings sidebar and separate dialogs are outside the content template.

Validate title position, content width, section typography, card radius and
scrolling on all three pages after changing the template. Also check a narrow
content area and both themes. Do not run `next build` while the development
server is running.
