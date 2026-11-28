import { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { DURATION, EASE_OUT } from "./motion";
import { PressableScale } from "./PressableScale";

export type Confirmation = {
  title: string;
  message: string;
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * Shared app confirmation surface; Android Back dismisses without taking action.
 * The card fades and settles in from 0.96, and plays its exit before the Modal unmounts.
 * Reopening mid-exit interrupts the exit from its current value instead of restarting.
 */
export function ConfirmationDialog({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation | null;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  // Keeps the last content on screen while the exit animation runs.
  const [shown, setShown] = useState<Confirmation | null>(confirmation);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (confirmation) {
      setShown(confirmation);
      progress.set(withTiming(1, { duration: DURATION.enter, easing: EASE_OUT }));
      return;
    }
    progress.set(
      withTiming(0, { duration: DURATION.exit, easing: EASE_OUT }, (finished) => {
        if (finished) scheduleOnRN(setShown, null);
      }),
    );
  }, [confirmation, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const cardStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: reduceMotion ? [] : [{ translateY: (1 - p) * 8 }, { scale: 0.96 + 0.04 * p }],
    };
  });

  const closing = confirmation === null;
  return (
    <Modal
      visible={shown !== null}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay} pointerEvents={closing ? "none" : "auto"}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <Animated.View style={[styles.card, cardStyle]} accessibilityViewIsModal>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={styles.title}>
              {shown?.title}
            </Text>
            <Text style={styles.message}>{shown?.message}</Text>
            <View style={styles.actions}>
              <PressableScale
                accessibilityRole="button"
                onPress={onClose}
                style={[styles.button, styles.cancel]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                onPress={() => {
                  const current = confirmation;
                  if (!current) return;
                  if (current.destructive)
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onClose();
                  current.onConfirm();
                }}
                style={[styles.button, styles.confirm, shown?.destructive && styles.destructive]}
              >
                <Text style={styles.confirmText}>{shown?.action}</Text>
              </PressableScale>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  backdrop: { backgroundColor: "rgba(0,0,0,0.65)" },
  card: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "85%",
    borderRadius: 24,
    backgroundColor: "#191919",
    borderColor: "#303030",
    borderWidth: 1,
    overflow: "hidden",
  },
  content: { padding: 24, gap: 18 },
  title: { color: "#fafafa", fontSize: 24, fontWeight: "600" },
  message: { color: "#aaa", fontSize: 16, lineHeight: 25 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 6 },
  button: {
    minHeight: 48,
    minWidth: 100,
    flexGrow: 1,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cancel: { borderWidth: 1, borderColor: "#393939" },
  confirm: { backgroundColor: "#fafafa" },
  destructive: { backgroundColor: "#fa8054" },
  cancelText: { color: "#eee", fontSize: 16, fontWeight: "500" },
  confirmText: { color: "#111", fontSize: 16, fontWeight: "600" },
});
