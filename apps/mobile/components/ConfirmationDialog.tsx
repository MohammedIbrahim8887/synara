import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type Confirmation = {
  title: string;
  message: string;
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/** Shared app confirmation surface; Android Back dismisses without taking action. */
export function ConfirmationDialog({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={confirmation !== null}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={styles.title}>
              {confirmation?.title}
            </Text>
            <Text style={styles.message}>{confirmation?.message}</Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const action = confirmation?.onConfirm;
                  onClose();
                  action?.();
                }}
                style={({ pressed }) => [
                  styles.button,
                  styles.confirm,
                  confirmation?.destructive && styles.destructive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.confirmText}>{confirmation?.action}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
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
    backgroundColor: "rgba(0,0,0,0.65)",
  },
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
  pressed: { opacity: 0.7 },
});
