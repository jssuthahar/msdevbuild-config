# msdevbuild-config

Shared MSDEVBUILD brand for every site (azure.msdevbuild.com, blog.msdevbuild.com, …):
one copy of the design tokens, the brand identity and a few Astro components.

Public on purpose: it holds only what already ships to the browser. Agent prompts,
skills and content guards live in the private `msdevbuild-tools` repo.

## What is here

| Path | What |
|---|---|
| `styles/tokens.css` | Brand colours, fonts and the light/dark tokens both sites share |
| `src/brand.ts` | `BRAND` (name, brand line, author, links) and `SOCIAL` profiles |
| `src/firebase.ts` | `FIREBASE` web config for the shared project `msdevbuild-azure` (public identifiers; the API key stays in each site, see the file) |
| `components/BrandLine.astro` | `MSDEVBUILD · Multi-Stack Dev Build`, inline or as a byline |
| `components/SocialLinks.astro` | Round social badges |
| `components/ShareButtons.astro` | LinkedIn / X / WhatsApp / Facebook / copy / native share |
| `components/SiteEngage.astro` | Promotions, feature switches, featured slot and campaign/push counts from admin.msdevbuild.com. Once, first inside `<body>`: `<SiteEngage site="blog" />` |
| `src/engage.ts` (`@msdevbuild/config/engage`) | `currentCampaign()` for forms (send it as `campaign`), `featureOn(key)` before opening anything switchable |

Only things that are the same on every site belong here. A component that knows about
exams, lessons or blog posts stays in its own repo.

## Use it in a site

```jsonc
// package.json: pin a tag, never a branch
"@msdevbuild/config": "github:jssuthahar/msdevbuild-config#v0.1.0"
```

```css
/* src/styles/global.css */
@import 'tailwindcss';
@import '@msdevbuild/config/tokens.css';
@source '../../node_modules/@msdevbuild/config';   /* so Tailwind sees the components' classes */
/* site overrides after this */
```

```astro
---
import BrandLine from '@msdevbuild/config/components/BrandLine.astro';
import { BRAND, SOCIAL } from '@msdevbuild/config';
---
```

While working on this repo next to a site, point the site at the folder instead:
`"@msdevbuild/config": "file:../msdevbuild-config"`.

## Releasing a change

1. Change it here, bump `version` in `package.json`.
2. `git tag v0.x.y && git push --tags`
3. In one site: bump the tag, `npm install`, run that site's checks (Azure: `npm run verify`).
4. Then the next site. Sites update one at a time, so a change never breaks two at once.
