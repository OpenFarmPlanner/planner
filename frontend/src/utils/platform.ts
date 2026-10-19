/** True on macOS/iOS, where app shortcuts use ⌘ instead of Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Ctrl on Windows/Linux, ⌘ on Apple platforms, with no other modifier pressed. */
export function isPrimaryModifierOnly(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }
  return isApplePlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}
