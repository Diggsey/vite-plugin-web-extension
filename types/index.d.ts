import type { Plugin, ChunkMetadata, FilterPattern } from "vite";

type ContentScript = {
  matches?: string[] | undefined;
  exclude_matches?: string[] | undefined;
  css?: string[] | undefined;
  js?: string[] | undefined;
  run_at?: string | undefined;
  all_frames?: boolean | undefined;
  match_about_blank?: boolean | undefined;
  include_globs?: string[] | undefined;
  exclude_globs?: string[] | undefined;
}

interface ViteWebExtensionOptions {
  /**
   * The manifest file to use as a base for the generated extension
   */
  manifest: chrome.runtime.Manifest;

  extraContentScripts?: ContentScript[];
  extraHtmlPages?: string[];

  /**
   * Sets the use_dynamic_url property on web accessible resources generated by the plugin
   * Default: true
   */
  useDynamicUrlContentScripts?: boolean;

  /**
   * Options for compiling web accessible scripts
   * <https://github.com/rollup/plugins/tree/master/packages/pluginutils#createfilter>
   *
   * Default: {
   *   include: /\.([cem]?js|ts)$/,
   *   exclude: "",
   * }
   */
  webAccessibleScripts?: {
    include?: FilterPattern | undefined;
    exclude?: FilterPattern | undefined;
    options?: {
      resolve?: string | false | null | undefined;
    };
  };
}

/**
 * Build cross platform, module-based web extensions using vite
 */
export default function webExtension(options?: ViteWebExtensionOptions): Plugin;

declare module "rollup" {
  export interface RenderedChunk {
    viteMetadata: ChunkMetadata;
  }
}
