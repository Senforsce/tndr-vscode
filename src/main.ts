import * as vscode from "vscode";
import {
  CancellationToken,
  CloseAction,
  CloseHandlerResult,
  CompletionItemKind,
  ConfigurationParams,
  ConfigurationRequest,
  ErrorAction,
  ErrorHandlerResult,
  Message,
  ProvideCompletionItemsSignature,
  ProvideDocumentFormattingEditsSignature,
  ResponseError,
} from "vscode-languageclient";
import fs from "fs/promises";
import path from "path";
import { LanguageClient } from "vscode-languageclient/node";
import { lookpath } from "lookpath";
import axios from "axios";
import { startServer } from "./server";

export async function activate(ctx: vscode.ExtensionContext) {
  try {
    ctx.subscriptions.push(
      vscode.commands.registerCommand(
        "tndr.restartServer",
        startLanguageClient
      )
    );

    await startLanguageClient();
  } catch (err) {
    const msg = err && (err as Error) ? (err as Error).message : "unknown";
    vscode.window.showErrorMessage(`error initializing t1 LSP: ${msg}`);
  }

  try {
    const settings = vscode.workspace.getConfiguration(
      "tndr.Turtle"
    );
    const lpfEndpoint =
      (settings.get("lpfServerEndpoint") as string) ?? "http://localhost:3002";
    const sparqlEndpoint =
      (settings.get("sparqlEndpoint") as string) ?? "http://localhost:3030/ds";
    const textDecoration =
      (settings.get("textDecoration") as string) ?? "underline";
    const color = (settings.get("color") as string) ?? "white";
    const backgroundColor = settings.get("backgroundColor") ?? "purple";

    const color2 = "gray";
    const backgroundColor2 = "transparent";
    const textDecoration2 = "none";

    const prefixes = settings.get("prefixes") as string;

    let commandDisposable = vscode.commands.registerCommand(
      "tndr.inspect",
      () => {
        startServer({
          lpfEndpoint,
          sparqlEndpoint,
          prefixes,
        });
      }
    );

    ctx.subscriptions.push(commandDisposable);

    let disposable = vscode.languages.registerHoverProvider(["go", "t1"], {
      async provideHover(document, position, token) {
        // Get the word at the current position

        const wordRange = document.getWordRangeAtPosition(
          position,
          /[ "].+[ "\n]/g
        );
        const word = wordRange ? document.getText(wordRange) : "";
        // Check if the word matches the pattern "prefix:SomeIdentifier"
        const pattern = /[ "](\w+:\w+)[ "\n]/g;
        const match = word.match(pattern);

        if (match) {
          const subj = match[1] ?? match[0].replaceAll(`"`, "");
          const resp = await axios.get(`${lpfEndpoint}/subject/${subj}`);

          console.log(resp);

          if (resp.status === 200 && resp.data) {
            console.log(resp.status, resp.data);

            const mkdown = `
### ${subj}

${resp.data?.p?.value} : ${resp.data?.o?.value}

                `;

            const hoverText = new vscode.MarkdownString(mkdown);
            console.log(resp.status, resp.data);

            return new vscode.Hover(hoverText);
          } else {
            console.log(resp.status, resp.data);
            const hoverText = new vscode.MarkdownString("loading.....");

            return new vscode.Hover(hoverText);
          }
        }
      },
    });

    ctx.subscriptions.push(disposable);
    let decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor,
      textDecoration,
      color,
    });

    let decorationType2 = vscode.window.createTextEditorDecorationType({
      backgroundColor: backgroundColor2,
      textDecoration: textDecoration2,
      color: color2,
    });

    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (!editor) {
          return;
        }
        updateDecorations(editor);
      },
      null,
      ctx.subscriptions
    );

    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (
          vscode.window.activeTextEditor &&
          event.document === vscode.window.activeTextEditor.document
        ) {
          updateDecorations(vscode.window.activeTextEditor);
        }
      },
      null,
      ctx.subscriptions
    );

    function updateDecorations(editor: vscode.TextEditor) {
      if (!editor) {
        return;
      }

      const regex = /[ "](\w+:\w+)[ "\n]/g;
      const text = editor.document.getText();
      const decorations: vscode.DecorationOptions[] = [];
      let match;
      while ((match = regex.exec(text))) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(
          match.index + match[0].length
        );
        const decoration = { range: new vscode.Range(startPos, endPos) };
        decorations.push(decoration);
      }

      const regex2 = /\/-\s(.+)\s-\//g;
      const decorations2: vscode.DecorationOptions[] = [];
      let match2;
      while ((match2 = regex2.exec(text))) {
        const startPos = editor.document.positionAt(match2.index);
        const endPos = editor.document.positionAt(
          match2.index + match2[0].length
        );
        const decoration = { range: new vscode.Range(startPos, endPos) };
        decorations2.push(decoration);
      }
      editor.setDecorations(decorationType2, decorations2);
      editor.setDecorations(decorationType, decorations);
    }
  } catch (err) {
    const msg = err && (err as Error) ? (err as Error).message : "unknown";
    vscode.window.showErrorMessage(`error initializing t1 LSP: ${msg}`);
  }
}

interface Configuration {
  goplsLog: string;
  goplsRPCTrace: boolean;
  log: string;
  pprof: boolean;
  http: string;
}

interface T1Ctx {
  languageClient?: LanguageClient;
}

const ctx: T1Ctx = {};

const loadConfiguration = (): Configuration => {
  const c = vscode.workspace.getConfiguration("templ");
  return {
    goplsLog: c.get("goplsLog") ?? "",
    goplsRPCTrace: !!c.get("goplsRPCTrace"),
    log: c.get("log") ?? "",
    pprof: !!c.get("pprof"),
    http: c.get("http") ?? "",
  };
};

const t1Locations = [
  path.join(process.env.GOBIN ?? "", "t1"),
  path.join(process.env.GOBIN ?? "", "t1.exe"),
  path.join(process.env.GOPATH ?? "", "bin", "t1"),
  path.join(process.env.GOPATH ?? "", "bin", "t1.exe"),
  path.join(process.env.GOROOT ?? "", "bin", "t1"),
  path.join(process.env.GOROOT ?? "", "bin", "t1.exe"),
  path.join(process.env.HOME ?? "", "bin", "t1"),
  path.join(process.env.HOME ?? "", "bin", "t1.exe"),
  path.join(process.env.HOME ?? "", "go", "bin", "t1"),
  path.join(process.env.HOME ?? "", "go", "bin", "t1.exe"),
  "/usr/local/bin/t1",
  "/usr/bin/t1",
  "/usr/local/go/bin/t1",
  "/usr/local/share/go/bin/t1",
  "/usr/share/go/bin/t1",
];

async function findTndr(): Promise<string> {
  const linuxName = await lookpath("t1");
  if (linuxName) {
    return linuxName;
  }
  const windowsName = await lookpath("t1.exe");
  if (windowsName) {
    return windowsName;
  }
  for (const exe of t1Locations) {
    try {
      await fs.stat(exe);
      return exe;
    } catch (err) {
      // ignore
    }
  }
  throw new Error(
    `Could not find tndr executable in path or in ${t1Locations.join(", ")}`
  );
}

async function stopLanguageClient() {
  const c = ctx.languageClient;
  ctx.languageClient = undefined;
  if (!c) return false;

  if (c.diagnostics) {
    c.diagnostics.clear();
  }
  // LanguageClient.stop may hang if the language server
  // crashes during shutdown before responding to the
  // shutdown request. Enforce client-side timeout.
  try {
    c.stop(2000);
  } catch (e) {
    c.outputChannel?.appendLine(`Failed to stop client: ${e}`);
  }
}

async function startLanguageClient() {
  ctx.languageClient = await buildLanguageClient();
  await ctx.languageClient.start();
}

export async function buildLanguageClient(): Promise<LanguageClient> {
  const documentSelector = [{ language: "tndr", scheme: "file" }];

  const config = loadConfiguration();
  const args: Array<string> = ["lsp"];
  if (config.goplsLog.length > 0) {
    args.push(`-goplsLog=${config.goplsLog}`);
  }
  if (config.goplsRPCTrace) {
    args.push(`-goplsRPCTrace=true`);
  }
  if (config.log.length > 0) {
    args.push(`-log=${config.log}`);
  }
  if (config.pprof) {
    args.push(`-pprof=true`);
  }
  if (config.http.length > 0) {
    args.push(`-http=${config.http}`);
  }

  const t1Path = await findTndr();

  if (ctx.languageClient) {
    await stopLanguageClient();
  }

  vscode.window.setStatusBarMessage(
    `Starting LSP: Tndr ${args.join(" ")}`,
    8989
  );

  const c = new LanguageClient(
    "tndr", // id
    "t1",
    {
      command: t1Path,
      args,
    },
    {
      documentSelector,
      uriConverters: {
        // Apply file:/// scheme to all file paths.
        code2Protocol: (uri: vscode.Uri): string =>
          (uri.scheme ? uri : uri.with({ scheme: "file" })).toString(),
        protocol2Code: (uri: string) => vscode.Uri.parse(uri),
      },
      errorHandler: {
        error: (
          error: Error,
          message: Message,
          count: number
        ): ErrorHandlerResult => {
          // Allow 5 crashes before shutdown.
          if (count < 5) {
            return { action: ErrorAction.Continue };
          }
          vscode.window.showErrorMessage(
            `Error communicating with the language server: ${error}: ${message}.`
          );
          return { action: ErrorAction.Shutdown };
        },
        closed: (): CloseHandlerResult => ({
          action: CloseAction.DoNotRestart,
        }),
      },
      middleware: {
        provideDocumentFormattingEdits: async (
          document: vscode.TextDocument,
          options: vscode.FormattingOptions,
          token: vscode.CancellationToken,
          next: ProvideDocumentFormattingEditsSignature
        ) => {
          return next(document, options, token);
        },
        provideCompletionItem: async (
          document: vscode.TextDocument,
          position: vscode.Position,
          context: vscode.CompletionContext,
          token: vscode.CancellationToken,
          next: ProvideCompletionItemsSignature
        ) => {
          const list = await next(document, position, context, token);
          if (!list) {
            return list;
          }
          const items = Array.isArray(list) ? list : list.items;

          // Give all the candidates the same filterText to trick VSCode
          // into not reordering our candidates. All the candidates will
          // appear to be equally good matches, so VSCode's fuzzy
          // matching/ranking just maintains the natural "sortText"
          // ordering. We can only do this in tandem with
          // "incompleteResults" since otherwise client side filtering is
          // important.
          if (
            !Array.isArray(list) &&
            list.isIncomplete &&
            list.items.length > 1
          ) {
            let hardcodedFilterText = items[0].filterText;
            if (!hardcodedFilterText) {
              // tslint:disable:max-line-length
              // According to LSP spec,
              // https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_completion
              // if filterText is falsy, the `label` should be used.
              // But we observed that's not the case.
              // Even if vscode picked the label value, that would
              // cause to reorder candidates, which is not ideal.
              // Force to use non-empty `label`.
              // https://github.com/golang/vscode-go/issues/441
              hardcodedFilterText = items[0].label.toString();
            }
            for (const item of items) {
              item.filterText = hardcodedFilterText;
            }
          }
          // TODO(hyangah): when v1.42+ api is available, we can simplify
          // language-specific configuration lookup using the new
          // ConfigurationScope.
          //    const paramHintsEnabled = vscode.workspace.getConfiguration(
          //          'editor.parameterHints',
          //          { languageId: 'go', uri: document.uri });
          const editorParamHintsEnabled = vscode.workspace.getConfiguration(
            "editor.parameterHints",
            document.uri
          )["enabled"];
          const goParamHintsEnabled = vscode.workspace.getConfiguration(
            "[go]",
            document.uri
          )["editor.parameterHints.enabled"];
          let paramHintsEnabled = false;
          if (typeof goParamHintsEnabled === "undefined") {
            paramHintsEnabled = editorParamHintsEnabled;
          } else {
            paramHintsEnabled = goParamHintsEnabled;
          }
          // If the user has parameterHints (signature help) enabled,
          // trigger it for function or method completion items.
          if (paramHintsEnabled) {
            for (const item of items) {
              if (
                item.kind === CompletionItemKind.Method ||
                item.kind === CompletionItemKind.Function
              ) {
                item.command = {
                  title: "triggerParameterHints",
                  command: "editor.action.triggerParameterHints",
                };
              }
            }
          }
          return list;
        },
        // Keep track of the last file change in order to not prompt
        // user if they are actively working.
        didOpen: async (e, next) => next(e),
        didChange: async (e, next) => next(e),
        didClose: (e, next) => next(e),
        didSave: (e, next) => next(e),
        workspace: {
          configuration: async (
            params: ConfigurationParams,
            token: CancellationToken,
            next: ConfigurationRequest.HandlerSignature
          ): Promise<any[] | ResponseError<void>> => {
            const configs = await next(params, token);
            if (!configs || !Array.isArray(configs)) {
              return configs;
            }
            const ret = [] as any[];
            for (let i = 0; i < configs.length; i++) {
              let workspaceConfig = configs[i];
              console.log(workspaceConfig);
              ret.push(workspaceConfig);
            }
            return ret;
          },
        },
      },
    },
    false
  );
  return c;
}
