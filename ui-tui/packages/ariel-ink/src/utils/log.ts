export function logError(error: unknown): void {
  if (!process.env.ARIEL_INK_DEBUG_ERRORS) {
    return
  }

  console.error(error)
}
