import { OutputBundle } from "rollup";
import { ParseResult } from "./manifestParser";
import {
  isSingleHtmlFilename,
  getOutputFileName,
  getInputFileName,
} from "../utils/file";
import ManifestParser from "./manifestParser";
import DevBuilder from "../devBuilder/devBuilder";
import { getServiceWorkerLoaderFile } from "../utils/loader";
import DevBuilderManifestV3 from "../devBuilder/devBuilderManifestV3";
import { getChunkInfoFromBundle } from "../utils/rollup";

type Manifest = chrome.runtime.ManifestV3;
type ManifestParseResult = ParseResult<Manifest>;

export default class ManifestV3 extends ManifestParser<Manifest> {
  protected createDevBuilder(): DevBuilder<Manifest> {
    return new DevBuilderManifestV3(
      this.viteConfig,
      this.pluginOptions,
      this.viteDevServer
    );
  }

  protected getHtmlFileNames(manifest: Manifest): string[] {
    const webAccessibleResourcesHtmlFileNames: string[] = [];

    (manifest.web_accessible_resources ?? []).forEach(({ resources }) =>
      resources.filter(isSingleHtmlFilename).forEach((html) => {
        webAccessibleResourcesHtmlFileNames.push(html);
      })
    );

    return [
      manifest.action?.default_popup,
      manifest.options_ui?.page,
      manifest.devtools_page,
      manifest.chrome_url_overrides?.newtab,
      manifest.chrome_url_overrides?.history,
      manifest.chrome_url_overrides?.bookmarks,
      ...(this.pluginOptions.extraHtmlPages || []),
      ...webAccessibleResourcesHtmlFileNames,
    ].filter((fileName): fileName is string => typeof fileName === "string");
  }

  protected getParseInputMethods(): ((
    result: ManifestParseResult
  ) => ManifestParseResult)[] {
    return [this.parseInputBackgroundServiceWorker];
  }

  protected getParseOutputMethods(): ((
    result: ManifestParseResult,
    bundle: OutputBundle
  ) => Promise<ManifestParseResult>)[] {
    return [this.parseOutputServiceWorker];
  }

  protected parseInputBackgroundServiceWorker(
    result: ManifestParseResult
  ): ManifestParseResult {
    if (!result.manifest.background?.service_worker) {
      return result;
    }

    const serviceWorkerScript = result.manifest.background?.service_worker;

    const inputFile = getInputFileName(
      serviceWorkerScript,
      this.viteConfig.root
    );
    const outputFile = getOutputFileName(serviceWorkerScript);

    result.inputScripts.push([outputFile, inputFile]);

    result.manifest.background.type = "module";

    return result;
  }

  protected parseInputWebAccessibleScripts(
    result: ParseResult<Manifest>
  ): ParseResult<Manifest> {
    result.manifest.web_accessible_resources?.forEach((struct) => {
      struct.resources.forEach((resource) => {
        if (resource.includes("*")) return;

        const inputFile = getInputFileName(resource, this.viteConfig.root);
        const outputFile = getOutputFileName(resource);

        if (this.webAccessibleScriptsFilter(inputFile)) {
          result.inputScripts.push([outputFile, inputFile]);
        }
      });
    });

    return result;
  }

  protected async parseOutputContentScripts(
    result: ManifestParseResult,
    bundle: OutputBundle
  ): Promise<ManifestParseResult> {
    const webAccessibleResources = new Set<
      Exclude<
        chrome.runtime.ManifestV3["web_accessible_resources"],
        undefined
      >[number]
    >([...(result.manifest.web_accessible_resources ?? [])]);

    this.getContentScripts(result).forEach((script) => {
      script.js?.forEach((scriptFileName, index) => {
        const parsedContentScript = this.parseOutputContentScript(
          scriptFileName,
          result,
          bundle
        );

        script.js![index] = parsedContentScript.scriptFileName;

        if (parsedContentScript.webAccessibleFiles.size) {
          const resource = {
            resources: Array.from(parsedContentScript.webAccessibleFiles),
            matches: script.matches!.map((matchPattern) => {
              const pathMatch = /[^:\/]\//.exec(matchPattern);
              if (!pathMatch) {
                return matchPattern;
              }

              const path = matchPattern.slice(pathMatch.index + 1);
              if (["/", "/*"].includes(path)) {
                return matchPattern;
              }

              return matchPattern.replace(path, "/*");
            }),
          };

          if (this.pluginOptions.useDynamicUrlContentScripts !== false) {
            // @ts-ignore - use_dynamic_url is supported, but not typed
            resource.use_dynamic_url = true;
          }

          webAccessibleResources.add(resource);
        }
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
      if (!resource.resources) {
        continue;
      }

      for (const fileName of resource.resources) {
        if (
          fileName.includes("*") ||
          !this.webAccessibleScriptsFilter(fileName)
        ) {
          continue;
        }

        const parsedScript = this.parseOutputWebAccessibleScript(
          fileName,
          result,
          bundle
        );

        if (parsedScript.webAccessibleFiles.size) {
          resource.resources = [
            ...resource.resources,
            ...parsedScript.webAccessibleFiles,
          ];
        }
      }
    }

    return result;
  }

  protected async parseOutputServiceWorker(
    result: ManifestParseResult,
    bundle: OutputBundle
  ): Promise<ManifestParseResult> {
    const serviceWorkerFileName = result.manifest.background?.service_worker;

    if (!serviceWorkerFileName) {
      return result;
    }

    const chunkInfo = getChunkInfoFromBundle(bundle, serviceWorkerFileName);
    if (!chunkInfo) {
      throw new Error(`Failed to find chunk info for ${serviceWorkerFileName}`);
    }

    const serviceWorkerLoader = getServiceWorkerLoaderFile(chunkInfo.fileName);

    result.manifest.background!.service_worker = serviceWorkerLoader.fileName;

    result.emitFiles.push({
      type: "asset",
      fileName: serviceWorkerLoader.fileName,
      source: serviceWorkerLoader.source,
    });

    return result;
  }
}
