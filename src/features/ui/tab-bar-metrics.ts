export const TAB_BAR_BASE_HEIGHT = 96;
export const MINI_TIMER_GAP = 8;

export function tabBarExtraHeight(fontScale: number): number {
  return Math.round(Math.max(0, Math.min(fontScale, 2) - 1) * 18);
}

export function tabBarHeight(bottomInset: number, fontScale: number): number {
  return TAB_BAR_BASE_HEIGHT + bottomInset + tabBarExtraHeight(fontScale);
}

export function miniTimerBottom(
  bottomInset: number,
  fontScale: number,
): number {
  return tabBarHeight(bottomInset, fontScale) + MINI_TIMER_GAP;
}
