# vite-plugin-ssg-singlefile

中文 | [English](./README_EN.md) 

 [![npm](https://img.shields.io/npm/v/@nekaii/vite-plugin-ssg-singlefile)](https://www.npmjs.com/package/@nekaii/vite-plugin-ssg-singlefile) [![GitHub](https://img.shields.io/badge/GitHub-View_on_GitHub-181717?logo=githube)](https://github.com/nexeora/vite-plugin-ssg-singlefile)

将 Vite 构建产物中的 JS 与 CSS 内联到 HTML 中，生成自包含的 html 文件。与 [vite-ssg](https://github.com/vitejs/vite-ssg) 完全兼容，需要 Vite 8+。

## 安装

```bash
pnpm add -D @nekaii/vite-plugin-ssg-singlefile
```

## 使用

### SSG 模式（默认）

与 vite-ssg 配合使用，插件默认以 SSG 模式启动，返回插件实例和两个生命周期钩子：

```ts
/// <reference types="vite-ssg" />
import { initPluginSingleFile } from '@nekaii/vite-plugin-ssg-singlefile'

const { pluginSingleFile, onPageRendered, onFinished } = initPluginSingleFile()

export default defineConfig({
  plugins: [pluginSingleFile],
  ssgOptions: { onPageRendered, onFinished },
})
```

- `pluginSingleFile` — 注册到 Vite 的 `plugins` 数组中
- `onPageRendered` — 注册到 vite-ssg 的 `ssgOptions.onPageRendered`，在每个页面渲染完成后内联其资源
- `onFinished` — 注册到 vite-ssg 的 `ssgOptions.onFinished`，在所有页面处理完成后删除已内联的原始文件

### 与已有 vite-ssg 钩子共存

如果项目中已经注册了 `onPageRendered` 等 vite-ssg 钩子（例如 naive-ui 的 SSR 样式收集），可以将其整合到同一个钩子函数中：

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
      // 先执行 naive-ui 的样式注入
      const withStyle = renderedHTML.replace(
        /<\/head>/,
        `${(appCtx as any).__collectStyle()}</head>`,
      )
      // 再执行资源内联
      return onPageRendered(route, withStyle)
    },
    onFinished,
  },
})
```

### 非 SSG 模式

如果你不使用 vite-ssg，可以指定 `ssg: false`，此时直接返回标准 Vite 插件，在 `generateBundle` 阶段完成内联：

```ts
import { initPluginSingleFile } from '@nekaii/vite-plugin-ssg-singlefile'

export default defineConfig({
  plugins: [initPluginSingleFile({ ssg: false })],
})
```

## 选项

### `initPluginSingleFile(options)`

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `ssg` | `boolean` | `true` | 是否启用 vite-ssg 兼容模式 |
| `allowExternalLink` | `boolean` | `true` | 是否允许保留外部链接；为 `false` 时遇到外部链接将抛出异常 |
| `moveDownInlinedScriptTag` | `boolean` | `true` | 是否将内联后的 `<script>` 标签移动到 `<body>` 底部。将脚本置于 body 末尾可以让浏览器先读取到并渲染页面内容，再读取并执行内联脚本，同时避免超过2mb的内联脚本使搜索引擎蜘蛛截断在没有页面内容的位置，仅对不含 `sync` 属性的模块脚本生效 |
| `moveDownInlinedStyleTag` | `boolean` | `true` | 是否将内联后的 `<style>` 标签移动到 `<body>` 底部。将非首屏样式置于 body 末尾可减少首屏关键路径的体积，但处理不当可能导致样式闪烁，可视情况关闭 |
| `delFiles` | `boolean \| Set<string>` | `true` | 文件删除策略：`true` 立即删除，`false` 不删除，`Set` 收集路径交由调用方处理 |
| `recursiveInline` | `boolean \| 'warn'` | `'warn'` | 是否递归内联 `<body>` 内部嵌套的 `<script>` 和 `<link>` 标签。`'warn'`：检测到嵌套时发出警告但不内联；`true`：递归内联所有嵌套标签；`false`：不递归内联也不发出警告 |
| `assets` | `Map<string, string>` | — | 预捕获的资源映射表，提供后将跳过磁盘读取 |

## 工作原理

1. 插件在 `config` 钩子中强制关闭 CSS 代码分割和 JS 代码分割
2. 在 `generateBundle` 阶段收集所有非 HTML 资源到内存映射表
3. 对每个 HTML 页面，解析其中的 `<script src="...">` 和 `<link rel="stylesheet" href="...">` 标签，将对应资源内容内联到 HTML 中
4. 内联完成后删除原始资源文件，若资源目录为空则一并移除

## 致谢

本项目的部分实现参考了 [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile)（MIT 协议）。

## License

MIT
