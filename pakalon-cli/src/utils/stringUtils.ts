const FULL_WIDTH_SPACE = '\u3000'

export function normalizeFullWidthSpace(input: string): string {
  return input.replace(new RegExp(FULL_WIDTH_SPACE, 'g'), ' ')
}
