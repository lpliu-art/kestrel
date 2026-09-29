import {
  extractImports,
  findEnclosing,
} from "../../../units/context-heuristic.ts";
import type { ContextProvider } from "../../api.ts";

export function heuristicContext(languageId: string): ContextProvider {
  return {
    build(input) {
      const source = input.file.newSource ?? "";
      const lines = source.split("\n");
      if (source.endsWith("\n")) lines.pop();
      return {
        enclosing: findEnclosing(lines, input.unit.startLine, languageId),
        imports: extractImports(lines),
      };
    },
  };
}
