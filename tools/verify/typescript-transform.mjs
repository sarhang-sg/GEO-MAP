import ts from 'typescript';

// Use the project's stable compiler rather than Node's experimental transformer.
export function stripTypeScriptTypes(source) {
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      useDefineForClassFields: false,
      verbatimModuleSyntax: true
    }
  });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: p => p,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n'
  }));
  return result.outputText;
}
