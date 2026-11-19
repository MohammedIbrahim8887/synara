import { useState } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { DURATION, EASE_OUT_CSS } from "./motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle> };

/**
 * Pressable with immediate press-in feedback: a 0.97 scale over 120ms as a Reanimated
 * CSS transition (UI thread, no per-frame JS). Reduced motion swaps the scale for a dim.
 */
export function PressableScale({ style, onPressIn, onPressOut, disabled, ...props }: Props) {
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const active = pressed && !disabled;
  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      pressRetentionOffset={16}
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={[
        style,
        {
          opacity: active && reduceMotion ? 0.75 : 1,
          transform: [{ scale: active && !reduceMotion ? 0.97 : 1 }],
          transitionProperty: ["transform", "opacity"],
          transitionDuration: DURATION.press,
          transitionTimingFunction: EASE_OUT_CSS,
        },
      ]}
    />
  );
}
