/**
 * @file 单文件实现的 vite 插件，用于内联 js 和 css 文件以生成自包含的 html 文件，与 vite-ssg 兼容
 * @since 0.1.0
 * @author nekaii <nexeora@outlook.com>
 * @license MIT
 */

import { parse, serialize, defaultTreeAdapter, html as p5Html, type DefaultTreeAdapterMap } from 'parse5'
import { type Plugin } from 'vite'
import { type OutputAsset } from 'rolldown';
import path from 'node:path'
import fs from 'node:fs'



type P5Node = DefaultTreeAdapterMap["childNode"]
type P5Element = DefaultTreeAdapterMap["element"]
type HtmlNode = P5Element & { nodeName: "html" };
function isHtml(n: P5Node): n is HtmlNode { return isElement(n) && n.nodeName === "html" }
type HeadNode = P5Element & { nodeName: "head" };
function isHead(n: P5Node): n is HeadNode { return isElement(n) && n.nodeName === "head" }
type BodyNode = P5Element & { nodeName: "body" };
function isBody(n: P5Node): n is BodyNode { return isElement(n) && n.nodeName === "body" }

const isElement = defaultTreeAdapter.isElementNode

function attr(el: P5Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/**
 * singlefile 函数的选项配置。
 *
 * 用于控制 HTML 单文件内联处理的各项行为，
 * 包括资源路径解析、外部链接策略、标签重排以及文件清理等。
 */
export interface SinglefileOptions {
  /**
   * 构建输出目录的路径。
   *
   * @default "dist/"
   * @example "path/to/dist/"
   */
  distPath?: string
  /**
   * 站点的公共基础路径（base URL）。
   *
   * 应与 Vite 的 `base` 配置保持一致，
   * 用于将 HTML 中的相对路径解析为正确的文件路径。
   *
   * @default "/"
   */
  baseUrl?: string

  /**
   * 当前正在处理的 HTML 文件所在的父目录路径。
   *
   * 用于正确解析 HTML 中相对引用（如 `<script src="...">`）的实际文件位置。
   * 通常在批量处理多个 HTML 文件时由调用方动态指定。
   * 默认与 `distPath` 相同
   */
  fileParentPath?: string

  /**
   * 是否允许保留外部链接（即不进行内联的远程或协议链接）。
   *
   * - `true`：外部链接正常保留。
   * - `false`：遇到外部链接时直接抛出异常。
   *
   * @default true
   */
  allowExternalLink?: boolean

  /**
   * 是否将内联后的 `<script>` 标签移动至 `<body>` 底部。
   *
   * 仅对原本通过 `src` 属性引入、且不含 `sync` 属性的模块脚本生效。
   * 这可以避免过大的脚本下载拖慢首屏渲染。
   *
   * @default true
   */
  moveDownInlinedScriptTag?: boolean

  /**
   * 是否将内联后生成的 `<style>` 标签移动至 `<body>` 底部。
   *
   * 将首屏渲染用不到的样式集中放置在 body 末尾可以避免过大的样式下载拖慢首屏渲染，
   * 但处理不当可能导致样式闪烁。
   *
   * @default true
   */
  moveDownInlinedStyleTag?: boolean

  /**
 * 文件删除策略。
 *
 * - `true`：内联完成后立即删除原始资源文件。
 * - `false`：不删除任何文件。
 * - `Set<string>`：收集待删除的文件路径到该集合，由调用方自行处理。
 *
 * @default true
 */
  delFiles?: boolean | Set<string>

  /**
   * 预捕获的资源映射表。
   *
   * 键为构建产物中的文件名（如 `assets/index-abc123.js`），
   * 值为对应的文件内容字符串。
   *
   * 当提供此映射表时，`singlefile` 将直接从中读取资源内容，
   * 而不再从磁盘读取文件。这通常用于与 Vite 的 `generateBundle` 钩子配合。
   */
  assets?: Map<string, string>
}

/**
 * 将 HTML 字符串中的所有本地 JS 与 CSS 资源内联为单一文件。
 *
 * 该函数会解析传入的 HTML 文档，查找其中所有指向本地文件的
 * `<script src="...">` 和 `<link rel="stylesheet" href="...">` 标签，
 * 将对应文件的内容读取后直接嵌入到 HTML 中，从而实现完整的单文件输出。
 * 注意目前只会处理作为 `<head>` 和 `<body>` 的直接子节点的script 和 link 标签，
 * 而对于在 `<body>` 内部嵌套过深的 script 和 link 标签目前不会进行递归分析处理。
 *
 * ## 参数
 *
 * @param html       - 待处理的原始 HTML 字符串（通常由 vite-ssg 渲染生成）。
 * @param options    - 处理选项，详见 {@link SinglefileOptions}。
 *
 * ## 返回值
 *
 * @returns 内联完成后的 HTML 字符串。
 *
 * ## 异常
 *
 * - 文档中缺少 `<html>` 或 `<head>` 元素时将抛出错误。
 * - 当 `allowExternalLink` 为 `false` 且遇到外部链接时将抛出错误。
 * - 通过资源映射表查找资源失败时将抛出错误。
 *
 * @example
 * ```ts
 * import fs from 'node:fs'
 * const html = '<html><head><link rel="stylesheet" href="style.css"></head><body><div/></body></html>'
 * fs.writeFileSync('dist/style.css', '.div: { padding:24px;} ')
 * const result = await singlefile(html, { distPath: 'dist/', baseUrl: '/' })
 * console.log(result)
 * // <html><head></head><body><div></div><style>.div: { padding:24px;}</style></body></html>
 * ```
 */
export async function singlefile(
  html: string,
  options: SinglefileOptions = {},
): Promise<string> {

  const distPath: string = options.distPath ?? "dist/"
  const curBaseurl: string = options.baseUrl ?? '/'
  const fileParentPath: string = options.fileParentPath ?? distPath
  const allowExternalLink: boolean = options.allowExternalLink ?? true
  const moveDownInlinedScriptTag: boolean = options.moveDownInlinedScriptTag ?? true
  const moveDownInlinedStyleTag: boolean = options.moveDownInlinedStyleTag ?? true
  const delFiles: boolean | Set<string> = options.delFiles ?? true
  const byMap: boolean = options.assets !== undefined
  async function mayDelFile(filePath: string): Promise<void> {
    if (delFiles === true) {
      await fs.promises.unlink(filePath)
    }
    else if (delFiles === false) {
      return
    }
    else {
      delFiles.add(filePath)
    }
  }
  /*@__NO_SIDE_EFFECTS__*/ function joinUrl(src: string): string {
    const res = path.posix.join(
      curBaseurl,
      path.posix.relative(distPath, fileParentPath),
      src // 如果它是绝对路径，前面所有都将被截断
    )
    if (res.startsWith(curBaseurl)) {
      return res
    }
    else throw new Error(`链接 {src} 无效"`)
  }
  /*@__NO_SIDE_EFFECTS__*/ function joinFilePath(url: string): string {
    return path.join(
      distPath,
      url.replace(curBaseurl, "")
    )
  }
  async function popFile(src: string): Promise<string> {
    const url = joinUrl(src)
    if (byMap) {
      const content = options.assets?.get(url.replace(curBaseurl, ''))
      if (content === undefined) throw new Error(`Asset not found: ${url.replace(curBaseurl, "")}`)
      await mayDelFile(joinFilePath(url))
      return content
    }
    else {
      const filePath = joinFilePath(url)
      const file = await fs.promises.readFile(
        filePath,
        "utf-8"
      )
      await mayDelFile(filePath)
      return file
    }
  }
  function isExternalLink(link: string) {
    const re = /^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:|\/\/|#)/
    return re.test(link) && (!link.startsWith("data:")) && (!link.startsWith("javascript:"))
  }
  const doc = parse(html);

  // 定位 html / head / body
  const htmlEl = doc.childNodes.find(isHtml)
  if (!htmlEl) throw new Error("<html> not found in document");
  const head = htmlEl.childNodes.find(isHead);
  let body = htmlEl.childNodes.find(isBody);

  if (!head) throw new Error("<head> not found in document");
  if (!body) {
    body = defaultTreeAdapter.createElement(
      'body',
      p5Html.NS.HTML,
      []
    ) as BodyNode
    defaultTreeAdapter.appendChild(
      htmlEl,
      body
    )
  }

  const elementList: { el: P5Element, idx: number }[] = []

  async function process(el: P5Element, idx: number): Promise<void> {
    const tag = el.tagName;


    if (tag === "script") {
      let text = ''
      const src = attr(el, "src")
      if (src && (!isExternalLink(src))) {
        text = await popFile(src)
        text = text.replace(/"?__VITE_PRELOAD__"?/g, "void 0").replace(/<(\/script>|!--)/g, "\\x3C$1").trim();

        defaultTreeAdapter.insertText(
          el,
          text
        )
        for (let i = el.attrs.length - 1; i >= 0; i--) {
          if (el.attrs[i].name === "crossorigin" || el.attrs[i].name === 'src') {  // 删除所有 crossorigin 和 src
            el.attrs.splice(i, 1);
          }
        }
        if ((!(attr(el, "sync") || (attr(el, "type") !== "module"))) && moveDownInlinedScriptTag) {
          defaultTreeAdapter.detachNode(el)
          elementList.push({ el, idx })
        }

        console.log(`inlined script: ${src}`)
      }
      else if (src) {
        if (!allowExternalLink) throw Error(`Unallowed external link: ${src}`)
      }
    }
    else if (tag === "link") {
      const rel = attr(el, "rel")?.toLowerCase();
      if (rel?.split(/\s+/).includes('stylesheet')) {
        let text = ''
        const newStyleEl = defaultTreeAdapter.createElement(
          'style',
          p5Html.NS.HTML,
          el.attrs.filter((value) => value.name !== "href" && value.name !== "rel" && value.name !== 'crossorigin')
        )
        const href = attr(el, "href")
        if (href && (!(isExternalLink(href)))) {

          text = await popFile(href)
          text = text.replace(/@charset\s+["'][^"']*["']\s*;?\s*/i, "").trim();

          defaultTreeAdapter.insertText(
            newStyleEl,
            text
          )
          defaultTreeAdapter.detachNode(el)
          if (moveDownInlinedStyleTag) {
            elementList.push({ el: newStyleEl, idx })
          }
          else {
            defaultTreeAdapter.appendChild(head!, newStyleEl)
          }
          console.log(`inlined stylesheet: ${href}`)
        }
        else if (href) {
          if (!allowExternalLink) throw Error(`Unallowed external link: ${href}`)
        }
      }
    }
  }

  await Promise.all(
    [
      ...head.childNodes, // head：遍历直接子节点
      ...body.childNodes // body：仅遍历直接子节点（不深入嵌套）
    ].map(async (c: P5Node, idx) => isElement(c) ? await process(c, idx) : void 0)
  );
  elementList.sort((a, b) => a.idx - b.idx).forEach((val) => defaultTreeAdapter.appendChild(body, val.el))

  return serialize(doc);
}


interface InitSinglefileOptionsSSG extends Omit<SinglefileOptions, "fileParentPath" | "distPath" | "baseUrl"> {
  ssg?: true
}
interface InitSinglefileOptionsWithoutSSG extends Omit<SinglefileOptions, "fileParentPath" | "distPath" | "baseUrl"> {
  ssg: false
}
/**
 * 插件初始化选项。
 * 
 * 继承自 `SinglefileOptions`，但排除了由插件内部自动管理的
 * `fileParentPath`、`distPath` 和 `baseUrl` 三个字段并添加了 `ssg` 字段。
 */
export interface InitSinglefileOptions extends Omit<SinglefileOptions, "fileParentPath" | "distPath" | "baseUrl"> {
  /**
   * 是否导出 vite-ssg 钩子函数。
   *
   * 启用将会额外返回 `onPageRendered` 和 `onFinished` 两个字段用于在 vite-ssg 的 `ssgOptions` 配置项中注册同名的钩子，
   * 原本的 vite 插件实例将被返回为 `pluginSingleFile` 字段。
   * 禁用后将会返回普通的 vite 插件实例
   *
   * @default true
   */
  ssg?: boolean
}

/**
 * SSG 模式下 `initPluginSingleFile` 的返回值。
 *
 * 当与 vite-ssg 配合使用时，除了返回 Vite 插件实例外，
 * 还额外暴露两个钩子函数供 SSG 生命周期调用。
 */
interface Initialized {
  /**
 * Vite 插件实例。
 *
 * 在 Vite 配置的 `plugins` 数组中注册。
 */
  pluginSingleFile: Plugin,

  /**
 * vite-ssg 页面渲染完成后的处理钩子。
 *
 * 该函数会将当前页面的资源内联，并返回处理后的 HTML。
 * 应当注册在 `ssgOptions` 的同名配置项中，如果项目中已有对应钩子可以将其整合到该钩子的处理函数中。
 *
 * @param route        - 当前页面的路由路径（如 `/about`）。
 * @param renderedHTML - vite-ssg 渲染生成的原始 HTML 字符串。
 * @returns 内联完成后的 HTML 字符串。
 */
  onPageRendered: (route: string, renderedHTML: string) => Promise<string>,

  /**
   * 所有页面处理完成后的清理钩子。
   *
   * 由 vite-ssg 在整个构建流程结束后调用。
   * 应当注册在 `ssgOptions` 的同名配置项中，如果项目中已有对应钩子可以将其整合到该钩子的处理函数中。
   * 负责删除已被内联的原始资源文件，并在资源目录为空时将其移除。
   * 如果不需要自动删除已内联文件，可以不注册该钩子。
   */
  onFinished: (() => Promise<void>)
}

/**
 * 创建一个 vite 插件实例用于将所有 js 和 css 文件内联到 html 文件中，兼容 vite-ssg，需要 vite 8+。
 *
 * 该函数默认返回一个对象，包含：
 *   - `pluginSingleFile` — Vite 插件实例
 *   - `onPageRendered` — vite-ssg 页面渲染钩子
 *   - `onFinished` — vite-ssg 构建完成钩子
 * 如果不需要在 vite-ssg 中使用，应该显式在选项中指定 `ssg: false`，这将令该函数直接返回标准的 vite 插件
 *
 * 插件会强制关闭 CSS 代码分割（`cssCodeSplit: false`）和 JS 代码分割（`codeSplitting: false`），
 * 并在 `generateBundle` 阶段收集所有非 HTML 资源，供后续内联使用。
 *
 * @param { InitSinglefileOptions } config - 初始化选项，详见 {@link InitSinglefileOptions}。
 * @returns { Initialized } 包含了 vite 插件实例和 vite-ssg 钩子的集成对象， 详见 {@link Initialized}
 *
 * @example
 * ```ts
 * /// <reference types="vite-ssg" />
 * // SSG 模式
 * import { initPluginSingleFile } from 'vite-plugin-ssg-singlefile'
 * const { pluginSingleFile, onPageRendered, onFinished } = initPluginSingleFile()
 * export default defineConfig({
 *   plugins: [pluginSingleFile],
 *   ssgOptions: { onPageRendered, onFinished }
 * })
 * ```
 */
export function initPluginSingleFile(config: InitSinglefileOptionsSSG): Initialized
/**
 * 创建 vite 单文件内联插件，兼容 vite-ssg，需要 vite 8+。
 *
 * 该函数在显式指定了 `ssg: false` 时返回标准 Vite 插件，并在 `generateBundle` 中内联 HTML 资源。
 * 在默认状态下时和显式指定了 `ssg: true` 时将返回一个对象，包含：
 *   - `pluginSingleFile` — Vite 插件实例
 *   - `onPageRendered` — vite-ssg 页面渲染钩子
 *   - `onFinished` — vite-ssg 构建完成钩子
 *
 * 插件会强制关闭 CSS 代码分割（`cssCodeSplit: false`）和 JS 代码分割（`codeSplitting: false`），
 * 并在 `generateBundle` 阶段收集所有非 HTML 资源，供后续内联使用。
 *
 * @param { InitSinglefileOptions } config - 初始化选项，详见 {@link InitSinglefileOptions}。
 * @returns { Plugin } vite 插件实例
 *
 * @example
 * ```ts
 * // 非 SSG 模式
 * import { initPluginSingleFile } from 'vite-plugin-ssg-singlefile'
 * export default defineConfig({
 *   plugins: [initPluginSingleFile({ ssg: false })]
 * })
 * ```
 *
 * @example
 * ```ts
 * /// <reference types="vite-ssg" />
 * // SSG 模式
 * import { initPluginSingleFile } from 'vite-plugin-ssg-singlefile'
 * const { pluginSingleFile, onPageRendered, onFinished } = initPluginSingleFile()
 * export default defineConfig({
 *   plugins: [pluginSingleFile],
 *   ssgOptions: { onPageRendered, onFinished }
 * })
 * ```
 */
export function initPluginSingleFile(config: InitSinglefileOptionsWithoutSSG): Plugin;

export function initPluginSingleFile(config: InitSinglefileOptions): Initialized | Plugin {
  const pluginSingleFile: Plugin = {
    name: "vite-plugin-ssg-singlefile",
    enforce: 'post'
  }
  const ssg = config.ssg ?? true
  let baseUrl = '/'
  let distPath = 'dist/'
  let assetsPath = 'assets/'
  const customSet = (typeof config.delFiles !== "boolean") && (config.delFiles !== undefined)
  const delFiles = config.delFiles === true ? new Set<string>() : (config.delFiles ?? new Set<string>())
  const assetsCaptured = new Map<string, string>()
  pluginSingleFile.config = () => {
    return {
      build: {
        cssCodeSplit: false,
        rolldownOptions: {
          output: {
            codeSplitting: false
          }
        }
      }
    }
  }
  pluginSingleFile.configResolved = (config) => {
    baseUrl = config.base
    distPath = config.build.outDir // vite会确保这里除非是 './' 或 '' ，不然必然以 '/' 开头以 '/' 结尾
    assetsPath = config.build.assetsDir
  }
  pluginSingleFile.generateBundle = async (_options, bundle) => {
    const indexs: OutputAsset[] = []
    for (const [fileName, file] of Object.entries(bundle)) {
      if (file.type === "asset") {
        const ext = path.parse(fileName).ext.toLowerCase()
        if (ext === ".css") {
          assetsCaptured.set(fileName, file.source as string)
        }
        if (ext === ".html") {
          indexs.push(file)
        }
      }
      else {
        assetsCaptured.set(fileName, file.code)
      }
    }
    if (!ssg) {
      for (const index of indexs) {
        const opt: SinglefileOptions = {
          ...config,
          fileParentPath: path.posix.parse(path.posix.join(distPath, index.fileName)).dir, // rolldown 提供的 index.fileName 不会包含 baseUrl
          distPath: distPath,
          baseUrl: baseUrl,
          delFiles: delFiles,
          assets: assetsCaptured
        }
          ; (bundle[index.fileName] as OutputAsset).source = await singlefile(index.source as string, opt)
        if ((!customSet) && (!(delFiles === false))) {
          [...delFiles].forEach((val) => delete bundle[path.posix.relative(distPath, val)])
        }
      }
    }
  }
  if (!ssg) {
    return pluginSingleFile
  }
  async function onPageRendered(route: string, renderedHTML: string): Promise<string> {
    const opt: SinglefileOptions = {
      ...config,
      fileParentPath: path.posix.join(distPath, path.posix.parse(route).dir.replace("/", "")),
      distPath: distPath,
      baseUrl: baseUrl,
      delFiles: delFiles,
      assets: assetsCaptured
    }
    return await singlefile(renderedHTML as string, opt)
  }
  async function onFinished() {
    if (!delFiles) return
    await Promise.all([...delFiles].map((val) => fs.promises.unlink(val)))
    try {
      if (((await fs.promises.readdir(path.join(distPath, assetsPath))).length === 0)) {
        await fs.promises.rm(path.join(distPath, assetsPath))
      }
    }
    catch (err) {

    }
  }
  return {
    pluginSingleFile,
    onPageRendered,
    onFinished
  }
}