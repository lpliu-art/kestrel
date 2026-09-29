import { astUnitContext } from "../../../treesitter/context.ts";
import {
  extractImports,
  findEnclosing,
} from "../../../units/context-heuristic.ts";
import type { ContextProvider } from "../../api.ts";

export function heuristicContext(_fallbackLanguage: string): ContextProvider {
  return {
    build(input) {
      const languageId = input.languageId || _fallbackLanguage;
      const source = input.file.newSource ?? "";
      const lines = source.split("\n");
      if (source.endsWith("\n")) lines.pop();
      const maxLines = input.maxEnclosingLines ?? 120;
      const ast = astUnitContext(
        source,
        languageId,
        input.unit.startLine,
        input.unit.endLine,
        maxLines,
      );
      if (ast) return ast;
      return {
        enclosing: findEnclosing(lines, input.unit.startLine, languageId),
        imports: extractImports(lines),
      };
    },
  };
}
