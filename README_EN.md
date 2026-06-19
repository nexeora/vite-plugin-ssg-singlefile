# vite-plugin-ssg-singlefile

[中文](./README.md) | [GitHub](https://github.com/Nexeora/vite-plugin-ssg-singlefile)

[![npm](https://img.shields.io/npm/v/@nekaii/vite-plugin-ssg-singlefile)](https://www.npmjs.com/package/@nekaii/vite-plugin-ssg-singlefile)

Inline JS and CSS from Vite build output into HTML to produce self-contained pages. Compatible with [vite-ssg](https://github.com/vitejs/vite-ssg). Requires Vite 8+.

## Installation

```bash
pnpm add -D @nekaii/vite-plugin-ssg-singlefile
```

## Usage

### SSG Mode (Default)

When used with vite-ssg, the plugin starts in SSG mode by default and returns a plugin instance along with two lifecycle hooks:

```ts
/// <reference types="vite-ssg" />
import { initPluginSingleFile } from '@nekaii/vite-plugin-ssg-singlefile'

const { pluginSingleFile, onPageRendered, onFinished } = initPluginSingleFile()

export default defineConfig({
  plugins: [pluginSingleFile],
  ssgOptions: { onPageRendered, onFinished },
})
```

- `pluginSingleFile` — Register in the Vite `plugins` array
- `onPageRendered` — Register in vite-ssg's `ssgOptions.onPageRendered`; inlines resources after each page is rendered
- `onFinished` — Register in vite-ssg's `ssgOptions.onFinished`; deletes inlined source files after all pages are processed

### Coexisting with Existing vite-ssg Hooks

If your project already registers vite-ssg hooks (e.g., naive-ui's SSR style collection), you can integrate them into the same hook function:

```ts
/// <reference types="vite-ssg" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { setup } from '@css-render/vue3-ssr'
import { initPluginSingleFile } from '@nekaii/vite-plugin-ssg-singlefile'

const { pluginSingleFile, onPageRendered, onFinished } = initPluginSingleFile()

export default defineConfig({
  plugins: [vue(), pluginSingleFile],
  ssr: {
    noExternal: ['naive-ui', 'vueuc', 'date-fns'],
  },
  ssgOptions: {
    async onBeforePageRender(_, __, appCtx) {
      const { collect } = setup(appCtx.app)
      ;(appCtx as any).__collectStyle = collect
      return undefined
    },
    async onPageRendered(route, renderedHTML, appCtx) {
      // Run naive-ui style injection first
      const withStyle = renderedHTML.replace(
        /<\/head>/,
        `${(appCtx as any).__collectStyle()}</head>`,
      )
      // Then inline resources
      return onPageRendered(route, withStyle)
    },
    onFinished,
  },
})
```

### Non-SSG Mode

If you don't use vite-ssg, set `ssg: false`. This returns a standard Vite plugin that inlines resources during the `generateBundle` phase:

```ts
import { initPluginSingleFile } from '@nekaii/vite-plugin-ssg-singlefile'

export default defineConfig({
  plugins: [initPluginSingleFile({ ssg: false })],
})
```

## Options

### `initPluginSingleFile(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ssg` | `boolean` | `true` | Enable vite-ssg compatibility mode |
| `allowExternalLink` | `boolean` | `true` | Whether to preserve external links; when `false`, throws on external links |
| `moveDownInlinedScriptTag` | `boolean` | `true` | Move inlined `<script>` tags to the end of `<body>`. Placing scripts at the end of body allows the browser to parse and render page content first, then execute inline scripts. Also prevents search engine crawlers from truncating at a position with no page content when inline scripts exceed 2MB. Only applies to module scripts without a `sync` attribute |
| `moveDownInlinedStyleTag` | `boolean` | `true` | Move inlined `<style>` tags to the end of `<body>`. Placing non-critical styles at the end of body reduces the size of the critical rendering path, but may cause a flash of unstyled content if not handled carefully — can be disabled as needed |
| `delFiles` | `boolean \| Set<string>` | `true` | File deletion strategy: `true` deletes immediately, `false` skips deletion, `Set` collects file paths for the caller to handle |
| `assets` | `Map<string, string>` | — | Pre-captured asset map; when provided, skips disk reads |

## How It Works

1. The plugin forces CSS code splitting and JS code splitting off in the `config` hook
2. During the `generateBundle` phase, all non-HTML assets are collected into an in-memory map
3. For each HTML page, `<script src="...">` and `<link rel="stylesheet" href="...">` tags are parsed and their corresponding resource content is inlined into the HTML
4. After inlining, original asset files are deleted; if the assets directory is empty, it is removed as well

## Acknowledgements

Part of this implementation references [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) (MIT License).

## License

MIT
