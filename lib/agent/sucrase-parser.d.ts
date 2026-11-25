// sucrase ships types for its parser, but not at the paths its compiled files are imported from.
declare module "sucrase/dist/parser" {
  export function parse(
    input: string,
    isJSXEnabled: boolean,
    isTypeScriptEnabled: boolean,
    isFlowEnabled: boolean
  ): { tokens: { type: number; start: number; end: number }[] }
}

declare module "sucrase/dist/parser/tokenizer/types" {
  export const TokenType: { string: number; template: number }
}
