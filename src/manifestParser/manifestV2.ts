import { ParseResult } from "./manifestParser";
import {
  isSingleHtmlFilename,
  getOutputFileName,
  getInputFileName,
} from "../utils/file";
import DevBuilderManifestV2 from "../devBuilder/devBuilderManifestV2";
import ManifestParser from "./manifestParser";
import DevBuilder from "./../devBuilder/devBuilder";
import { OutputBundle } from "rollup";

type Manifest = chrome.runtime.ManifestV2;
type ManifestParseResult = ParseResult<Manifest>;

export default class ManifestV2 extends ManifestParser<Manifest> {
  protected createDevBuilder(): DevBuilder<Manifest> {
    return new DevBuilderManifestV2(
      this.viteConfig,
      this.pluginOptions,
      this.viteDevServer
    );
  }

  protected getHtmlFileNames(manifest: Manifest): string[] {
    return [
      manifest.background?.page,
      manifest.browser_action?.default_popup,
      manifest.options_ui?.page,
      manifest.devtools_page,
      manifest.chrome_url_overrides?.newtab,
      manifest.chrome_url_overrides?.history,
      manifest.chrome_url_overrides?.bookmarks,
      ...(this.pluginOptions.extraHtmlPages || []),
      ...(manifest.web_accessible_resources ?? []).filter(isSingleHtmlFilename),
    ].filter((fileName): fileName is string => typeof fileName === "string");
  }

  protected getParseInputMethods(): ((
    result: ManifestParseResult
  ) => ManifestParseResult)[] {
    return [];
  }

  protected getParseOutputMethods(): ((
    result: ManifestParseResult
  ) => Promise<ManifestParseResult>)[] {
    return [this.parseWatchModeSupport.bind(this)];
  }

  protected parseInputWebAccessibleScripts(
    result: ParseResult<Manifest>
  ): ParseResult<Manifest> {
    result.manifest.web_accessible_resources?.forEach((resource) => {
      if (resource.includes("*")) return;

      const inputFile = getInputFileName(resource, this.viteConfig.root);
      const outputFile = getOutputFileName(resource);

      if (this.webAccessibleScriptsFilter(inputFile)) {
        result.inputScripts.push([outputFile, inputFile]);
      }
    });

    return result;
  }

  protected async parseOutputContentScripts(
    result: ManifestParseResult,
    bundle: OutputBundle
  ): Promise<ManifestParseResult> {
    const webAccessibleResources = new Set(
      result.manifest.web_accessible_resources ?? []
    );

    this.getContentScripts(result).forEach((script) => {
      script.js?.forEach((scriptFileName, index) => {
        const parsedContentScript = this.parseOutputContentScript(
          scriptFileName,
          result,
          bundle
        );

        script.js![index] = parsedContentScript.scriptFileName;

        parsedContentScript.webAccessibleFiles.forEach(
          webAccessibleResources.add,
          webAccessibleResources
        );
      });
    });

    if (webAccessibleResources.size > 0) {
      result.manifest.web_accessible_resources = Array.from(
        webAccessibleResources
      );
    }

    return result;
  }

  protected async parseOutputWebAccessibleScripts(
    result: ManifestParseResult,
    bundle: OutputBundle
  ): Promise<ManifestParseResult> {
    if (!result.manifest.web_accessible_resources) {
      return result;
    }

    for (const resource of result.manifest.web_accessible_resources) {
      if (
        resource.includes("*") ||
        !this.webAccessibleScriptsFilter(resource)
      ) {
        continue;
      }

      const parsedContentScript = this.parseOutputWebAccessibleScript(
        resource,
        result,
        bundle
      );

      result.manifest.web_accessible_resources = [
        ...result.manifest.web_accessible_resources,
        ...parsedContentScript.webAccessibleFiles,
      ];
    }

    return result;
  }

  protected async parseWatchModeSupport(
    result: ManifestParseResult
  ): Promise<ManifestParseResult> {
    if (!result.manifest.web_accessible_resources) {
      return result;
    }

    if (
      result.manifest.web_accessible_resources.length > 0 &&
      this.viteConfig.build.watch
    ) {
      // expose all files in watch mode to allow web-ext reloading to work when manifest changes are not applied on reload (eg. Firefox)
      //result.manifest.web_accessible_resources.push("*.js");
    }

    return result;
  }
}
