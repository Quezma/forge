import ts from "typescript";
import path from "node:path";
import { createHash } from "node:crypto";
import { areaOf, type Areas } from "./area.ts";

// Pure in-memory indexer: TS program in, plain JSON-serializable object out.
const STATE_MODULES = /^(zustand|react-redux|@reduxjs\/toolkit|redux|jotai|recoil|valtio)(\/|$)/;
const COLOR = /(^|[\s:(,])(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]*\))($|[\s;,)])/i;

/** `*.test.*`, `*.spec.*` or anything under `__tests__/`. */
export const isTestFile = (f: string) => /\.(test|spec)\.[^/]+$|(^|\/)__tests__\//.test(f);

export function buildIndex(rootArg: string, opts: { config?: { areas?: Areas } } = {}) {
  const root = path.resolve(rootArg);
  const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
  const program = createProgram(root);
  const checker = program.getTypeChecker();
  const sources = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && !sf.fileName.includes("/node_modules/") && !path.relative(root, sf.fileName).startsWith("..") && !isTestFile(rel(sf.fileName)));

  const symbols: Record<string, any> = {};
  const declId = new Map<ts.Node, string>();
  const files: Record<string, string> = {};
  const usages: any[] = [];
  const calls: any[] = [];
  const styles: any[] = [];
  const fns = new Map<string, ts.Node>();

  const line = (n: ts.Node) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const tail = (e: ts.Node): ts.Node => (ts.isPropertyAccessExpression(e) ? e.name : e);

  // Syntactic import lookup: works even when the module does not resolve.
  function importOf(e: ts.Node): { module: string; name: string } | undefined {
    const fromDecl = (d: ts.Node | undefined, local: string) => {
      if (!d) return undefined;
      if (ts.isImportSpecifier(d)) return { module: (d.parent.parent.parent.moduleSpecifier as ts.StringLiteral).text, name: (d.propertyName ?? d.name).text };
      if (ts.isImportClause(d)) return { module: (d.parent.moduleSpecifier as ts.StringLiteral).text, name: local };
      return undefined;
    };
    if (ts.isIdentifier(e)) return fromDecl(checker.getSymbolAtLocation(e)?.declarations?.[0], e.text);
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const d = checker.getSymbolAtLocation(e.expression)?.declarations?.[0];
      if (d && ts.isNamespaceImport(d)) return { module: (d.parent.parent.moduleSpecifier as ts.StringLiteral).text, name: e.name.text };
      if (d && ts.isImportClause(d)) return { module: (d.parent.moduleSpecifier as ts.StringLiteral).text, name: e.name.text };
    }
    return undefined;
  }

  function resolve(e: ts.Node): string | undefined {
    let s = checker.getSymbolAtLocation(tail(e));
    if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    for (const d of s?.declarations ?? []) if (declId.has(d)) return declId.get(d);
  }

  const unwrap = (e: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
    if (ts.isCallExpression(e) && e.arguments.length && ["memo", "forwardRef"].includes(importOf(e.expression)?.name ?? (ts.isIdentifier(e.expression) ? e.expression.text : ""))) return unwrap(e.arguments[0]);
    return e;
  };
  const hasJsx = (n: ts.Node): boolean => {
    let found = false;
    const walk = (c: ts.Node) => {
      if (found) return;
      if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || ts.isJsxFragment(c)) found = true;
      else ts.forEachChild(c, walk);
    };
    walk(n);
    return found;
  };
  const isFn = (e: ts.Node): e is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(e) || ts.isArrowFunction(e) || ts.isFunctionExpression(e);

  function classify(init: ts.Node | undefined, name: string): string | undefined {
    if (!init) return undefined;
    const e = ts.isExpression(init) ? unwrap(init) : init;
    if (ts.isCallExpression(e)) {
      let c: ts.Expression = e.expression;
      while (ts.isCallExpression(c)) c = c.expression; // create<T>()(...)
      const imp = importOf(c);
      if (imp?.name === "createContext") return "context";
      if (imp && ((imp.name === "create" || imp.name === "createStore") && imp.module.startsWith("zustand") || ["createSlice", "configureStore"].includes(imp.name) && imp.module.startsWith("@reduxjs/toolkit"))) return "store";
      return undefined;
    }
    if (!isFn(e)) return undefined;
    if (/^use[A-Z]/.test(name)) return "hook";
    return /^[A-Z]/.test(name) && e.body && hasJsx(e.body) ? "component" : "function";
  }

  // Pass 1: symbols
  for (const sf of sources) {
    const file = rel(sf.fileName);
    files[file] = createHash("sha1").update(sf.text).digest("hex");
    const mod = checker.getSymbolAtLocation(sf);
    const exported = new Set<ts.Node>();
    for (const x of mod ? checker.getExportsOfModule(mod) : []) {
      const s = x.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(x) : x;
      s.declarations?.forEach((d) => exported.add(d));
    }
    const add = (decl: ts.Node, nameNode: ts.Node | undefined, name: string, kind: string, fn?: ts.Node, doc?: ts.Node) => {
      const sym = nameNode && checker.getSymbolAtLocation(nameNode);
      const tags = sym ? sym.getJsDocTags(checker) : [];
      const dep = tags.find((t) => t.name === "deprecated");
      const sid = `${file}#${name}`;
      const s: any = {
        id: sid, name, kind, file, line: line(decl), exported: exported.has(decl), area: areaOf(file, opts.config?.areas),
        doc: sym ? ts.displayPartsToString(sym.getDocumentationComment(checker)).split(/\n\s*\n/)[0].trim() : "",
        deprecated: !!dep, deprecatedText: dep ? ts.displayPartsToString(dep.text) : "", callers: 0,
      };
      if (kind === "component") (Object.assign(s, props(fn, decl)), fns.set(sid, fn ?? decl));
      symbols[sid] = s;
      declId.set(decl, sid);
    };
    const base = path.basename(file).replace(/\.[^.]+$/, "");
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st)) {
        const name = st.name?.text ?? base;
        if (st.body) add(st, st.name, name, classify(st, name)!, st);
      } else if (ts.isClassDeclaration(st)) {
        const name = st.name?.text ?? base;
        const h = st.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
        if (h && /(^|\.)(Pure)?Component$/.test(h.expression.getText())) add(st, st.name, name, "component", st);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const kind = classify(d.initializer, d.name.text);
          if (kind) add(d, d.name, d.name.text, kind, d.initializer && unwrap(d.initializer));
        }
      } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
        const kind = classify(st.expression, base[0]?.toUpperCase() + base.slice(1));
        if (kind) add(st, undefined, base, kind, unwrap(st.expression));
      }
    }
  }

  function props(fn: ts.Node | undefined, decl: ts.Node) {
    let t: ts.Type | undefined;
    let at: ts.Node = decl;
    if (fn && isFn(fn) && fn.parameters[0]) [t, at] = [checker.getTypeAtLocation(fn.parameters[0]), fn.parameters[0]];
    else if (fn && ts.isClassDeclaration(fn)) {
      const a = fn.heritageClauses?.[0]?.types[0]?.typeArguments?.[0];
      if (a) [t, at] = [checker.getTypeFromTypeNode(a), a];
    }
    const ps = t ? t.getProperties() : [];
    return {
      props: ps.map((p) => ({ name: p.name, optional: !!(p.flags & ts.SymbolFlags.Optional), type: checker.typeToString(checker.getTypeOfSymbolAtLocation(p, at)) })),
      deprecatedProps: ps.filter((p) => p.getJsDocTags(checker).some((x) => x.name === "deprecated")).map((p) => p.name),
    };
  }

  function targetOf(tag: ts.Node): string {
    const text = tag.getText();
    if (ts.isIdentifier(tag) && /^[a-z]/.test(text)) return `intrinsic:${text}`;
    const imp = importOf(tag);
    return resolve(tag) ?? (imp && !imp.module.startsWith(".") ? `external:${imp.module}#${imp.name}` : `unresolved:${text}`);
  }

  // Structure fingerprint of the JSX a component returns: tags/resolved ids, sorted attribute names,
  // `{` `}` around expression children (with any JSX inside them, e.g. `.map()` callbacks and
  // conditionals) and "txt" placeholders; literal values and identifier names are dropped.
  function shapeOf(root: ts.Node): string[] {
    const out: string[] = [];
    const el = (n: ts.Node): void => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        const open = ts.isJsxElement(n) ? n.openingElement : n;
        const t = targetOf(open.tagName).replace(/^intrinsic:/, "");
        out.push(`<${t}`);
        const attrs = open.attributes.properties.map((a) => (ts.isJsxSpreadAttribute(a) ? "..." : `@${a.name.getText()}`));
        out.push(...attrs.sort());
        if (ts.isJsxElement(n)) n.children.forEach(el);
        out.push(`/${t}`);
      } else if (ts.isJsxFragment(n)) {
        out.push("<>");
        n.children.forEach(el);
        out.push("/>");
      } else if (ts.isJsxExpression(n)) {
        out.push("{");
        if (n.expression) find(n.expression);
        out.push("}");
      }
      else if (ts.isJsxText(n) && n.text.trim()) out.push('"txt"');
    };
    const find = (n: ts.Node): void => (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) ? el(n) : ts.forEachChild(n, find));
    find(root);
    return out;
  }
  // Target of the outermost element a component returns (null: fragment, non-JSX or nothing).
  function rootOf(fn: ts.Node): string | null {
    let found: string | null | undefined;
    const walk = (n: ts.Node): void => {
      if (found !== undefined) return;
      if (n !== fn && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n))) return;
      let e: ts.Node | undefined = ts.isReturnStatement(n) ? n.expression : n === fn && ts.isArrowFunction(n) && !ts.isBlock(n.body) ? n.body : undefined;
      while (e && ts.isParenthesizedExpression(e)) e = e.expression;
      if (e && (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e))) found = targetOf((ts.isJsxElement(e) ? e.openingElement : e).tagName);
      else if (e && ts.isJsxFragment(e)) found = null;
      else ts.forEachChild(n, walk);
    };
    walk(fn);
    return found ?? null;
  }
  for (const [sid, fn] of fns) {
    const shape = shapeOf(fn);
    Object.assign(symbols[sid], { shape, shapeSize: shape.filter((t) => !t.startsWith("/") && t !== "}").length, root: rootOf(fn) });
  }

  // Pass 2: usages, calls, styles
  for (const sf of sources) {
    const file = rel(sf.fileName);
    const visit = (n: ts.Node, from: string) => {
      from = declId.get(n) ?? from;
      const site = { file, line: line(n) };
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName;
        const props: string[] = [];
        let spread = false;
        for (const a of n.attributes.properties) {
          if (ts.isJsxSpreadAttribute(a)) spread = true;
          else props.push(a.name.getText());
        }
        const target = targetOf(tag);
        usages.push({ target, ...site, from, props, spread });
      } else if (ts.isJsxAttribute(n) && n.name.getText() === "style") {
        styles.push({ ...site, from, kind: "inline_style", text: n.getText(), static: isStaticStyle(n) });
      } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && symbols[from]?.kind === "component" && COLOR.test(n.text)) {
        styles.push({ ...site, from, kind: "color_literal", text: n.text });
      } else if (ts.isCallExpression(n)) {
        const target = resolve(n.expression);
        const imp = importOf(n.expression);
        const ext = imp && (STATE_MODULES.test(imp.module) || (imp.module === "react" && ["useContext", "useReducer"].includes(imp.name)));
        if (target) calls.push({ target, from, ...site });
        else if (ext) calls.push({ target: `external:${imp.module}#${imp.name}`, from, ...site });
        const ctx = n.arguments[0] && (tail(n.expression) as ts.Identifier).text === "useContext" && resolve(n.arguments[0]);
        if (ctx) calls.push({ target: ctx, via: "useContext", from, ...site });
      }
      ts.forEachChild(n, (c) => visit(c, from));
    };
    visit(sf, `${file}#<module>`);
  }

  const seen = new Map<string, Set<string>>();
  for (const e of [...usages, ...calls]) seen.set(e.target, (seen.get(e.target) ?? new Set()).add(e.from));
  for (const s of Object.values(symbols)) s.callers = seen.get(s.id)?.size ?? 0;

  // Syntax errors only (semantic errors are common in real projects); the store decides what to do.
  const syntaxError = sources.flatMap((sf) => program.getSyntacticDiagnostics(sf))[0];
  return { ...(syntaxError && { syntaxError: ts.flattenDiagnosticMessageText(syntaxError.messageText, "\n") }), symbols, usages, calls, styles, files, meta: { root, builtAt: new Date().toISOString(), tsVersion: ts.version, format: 4 } };
}

// style={{ a: "x", b: 1 }}: an object literal whose every value is a string/number literal.
function isStaticStyle(attr: ts.JsxAttribute): boolean {
  const e = attr.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
  const lit = (v: ts.Expression) => ts.isStringLiteral(v) || ts.isNumericLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v) || (ts.isPrefixUnaryExpression(v) && ts.isNumericLiteral(v.operand));
  return !!e && ts.isObjectLiteralExpression(e) && e.properties.every((p) => ts.isPropertyAssignment(p) && lit(p.initializer));
}

function createProgram(root: string) {
  const cfgPath = path.join(root, "tsconfig.json");
  let parsed: ts.ParsedCommandLine;
  if (ts.sys.fileExists(cfgPath)) {
    parsed = parseConfig(cfgPath);
    // Solution-style config (Vite default: files [] + references): index the referenced
    // project that compiles JSX, else the one with the most files.
    if (!parsed.fileNames.length && parsed.projectReferences?.length) {
      const refs = parsed.projectReferences.map((r) => parseConfig(ts.resolveProjectReferencePath(r)));
      parsed = refs.find((r) => r.options.jsx !== undefined && r.fileNames.length) ?? refs.sort((a, b) => b.fileNames.length - a.fileNames.length)[0];
    }
  } else {
    // ponytail: no tsconfig -> src/** with allowJs; add include/exclude globs if projects need it
    parsed = {
      errors: [],
      fileNames: ts.sys.readDirectory(path.join(root, "src"), [".ts", ".tsx", ".js", ".jsx"], ["node_modules"]),
      options: { allowJs: true, jsx: ts.JsxEmit.Preserve, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    };
  }
  return ts.createProgram(parsed.fileNames, parsed.options);
}

const parseConfig = (file: string) =>
  ts.parseJsonConfigFileContent(ts.readConfigFile(file, ts.sys.readFile).config, ts.sys, path.dirname(file), undefined, file);
