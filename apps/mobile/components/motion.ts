import {
  cubicBezier,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  ReduceMotion,
} from "react-native-reanimated";

/**
 * Shared motion tokens for the native shell. Every animation here is opacity or
 * transform only, so it runs on the UI thread without relayout of the WebView.
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_OUT_CSS = cubicBezier(0.23, 1, 0.32, 1);

export const DURATION = {
  press: 120,
  exit: 160,
  enter: 220,
  reveal: 280,
} as const;

/** Screen swaps: a plain cross-fade. Kept under reduced motion because it explains the state change. */
export const screenEnter = FadeIn.duration(DURATION.enter)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.Never);
export const screenExit = FadeOut.duration(DURATION.exit)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.Never);

/** Revealing the workspace once the WebView has painted. */
export const revealExit = FadeOut.duration(DURATION.reveal)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.Never);

/**
 * Fade with a short rise, staggered by `index`. Used for first-run copy and notices.
 * With reduced motion it degrades to a plain fade with no stagger or travel.
 */
export function rise(index: number, reduceMotion: boolean, distance = 12) {
  if (reduceMotion) return screenEnter;
  return FadeInDown.duration(DURATION.reveal)
    .delay(index * 50)
    .easing(EASE_OUT)
    .withInitialValues({ opacity: 0, transform: [{ translateY: distance }] });
}
