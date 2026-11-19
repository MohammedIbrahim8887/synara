import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import * as Haptics from "expo-haptics";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import {
  isLocalConnectionEndpoint,
  parseLocalDeviceInvitation,
} from "@synara/contracts/localConnections";
import { ConfirmationDialog, type Confirmation } from "./components/ConfirmationDialog";
import { PressableScale } from "./components/PressableScale";
import { revealExit, rise, screenEnter, screenExit } from "./components/motion";

type Connection = { endpoint: string; certificateFingerprint: string; credential?: string };
const NativeConnection = requireNativeViewManager<{
  connection: Connection;
  backRequest: number;
  style: object;
  onState: (event: { nativeEvent: { state: string; message?: string } }) => void;
  onExternalLink: (event: { nativeEvent: { url: string } }) => void;
  onBackBoundary: () => void;
}>("SonaConnection");
const connectionModule = requireNativeModule<{ clearSession: () => Promise<void> }>(
  "SonaConnection",
);
const STORAGE_KEY = "sona.local.connection";

async function allowLocalNetwork() {
  if (Platform.OS !== "android" || Number(Platform.Version) < 37) return true;
  return (
    (await PermissionsAndroid.request(
      "android.permission.ACCESS_LOCAL_NETWORK" as Parameters<typeof PermissionsAndroid.request>[0],
    )) === PermissionsAndroid.RESULTS.GRANTED
  );
}

function Companion() {
  const [permission, requestPermission] = useCameraPermissions();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [backRequest, setBackRequest] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    void (async () => {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored) {
        const saved = JSON.parse(stored);
        if (
          !isLocalConnectionEndpoint(saved.endpoint) ||
          typeof saved.certificateFingerprint !== "string" ||
          !/^[a-f0-9]{64}$/.test(saved.certificateFingerprint)
        )
          throw Error();
        if (!(await allowLocalNetwork())) throw Error();
        setConnection({
          endpoint: saved.endpoint,
          certificateFingerprint: saved.certificateFingerprint,
        });
        setStatus("loading");
      } else setStatus("idle");
    })().catch(() => {
      setStatus("idle");
      setMessage(
        "Saved connection could not be opened. Check local network permission, then scan again.",
      );
    });
  }, []);
  useEffect(() => {
    if (!connection || status !== "loading") return;
    const timer = setTimeout(() => {
      setStatus("error");
      setMessage(
        "Connection timed out. Check Wi-Fi and local connections. If the code was already used, scan a new one.",
      );
    }, 30_000);
    return () => clearTimeout(timer);
  }, [connection, status, attempt]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (scanning) {
        scanningRef.current = false;
        setScanning(false);
        return true;
      }
      if (connection) {
        setBackRequest((value) => value + 1);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [connection, scanning]);
  const scan = (raw: string) => {
    if (!scanningRef.current) return;
    scanningRef.current = false;
    setScanning(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      // Validate the server-issued 12-character invitation before opening any network connection.
      const data = parseLocalDeviceInvitation(raw);
      setConfirmation({
        title: "Connect to this computer?",
        message: `Sona at ${new URL(data.endpoint).host} will manage your projects and agent sessions. Only scan a code from your own Sona window.`,
        action: "Connect",
        onConfirm: () => {
          // A code can expire while the confirmation is open.
          try {
            parseLocalDeviceInvitation(raw);
          } catch {
            setMessage("This code expired. Create a new pairing code on your computer.");
            return;
          }
          setConnection({
            endpoint: data.endpoint,
            certificateFingerprint: data.certificateFingerprint,
            credential: data.credential,
          });
          setAttempt((value) => value + 1);
          setStatus("loading");
          setMessage("");
        },
      });
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setMessage(
        "This code is invalid or expired. Create a new code in Sona → Settings → Connections.",
      );
    }
  };
  const startScan = async () => {
    if (!(await allowLocalNetwork())) {
      setMessage("Allow local network access in Android settings to connect to your computer.");
      return;
    }
    const granted = permission?.granted || (await requestPermission()).granted;
    if (granted) {
      scanningRef.current = true;
      setScanning(true);
    } else setMessage("Camera access is needed to scan. Enable it in Android settings.");
  };
  const disconnect = () =>
    setConfirmation({
      title: "Disconnect this phone?",
      message:
        "This removes its saved connection and local session. You can also revoke access from the computer’s Connections settings.",
      action: "Disconnect",
      destructive: true,
      onConfirm: () => {
        setConnection(null);
        setStatus("idle");
        setMessage("");
        void Promise.all([
          connectionModule.clearSession(),
          SecureStore.deleteItemAsync(STORAGE_KEY),
        ]).catch(() =>
          setMessage("Could not clear saved access. Revoke this device from your computer."),
        );
      },
    });
  const cancelScan = () => {
    scanningRef.current = false;
    setScanning(false);
  };
  return (
    <SafeAreaView style={styles.screen}>
      <ConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      {scanning ? (
        <Animated.View
          key="scan"
          entering={screenEnter}
          exiting={screenExit}
          style={styles.content}
        >
          <CameraView
            style={styles.content}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => scan(data)}
          />
          <View style={styles.footer}>
            <PressableScale accessibilityRole="button" style={styles.button} onPress={cancelScan}>
              <Text style={styles.buttonText}>Cancel scanning</Text>
            </PressableScale>
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          key="main"
          entering={screenEnter}
          exiting={screenExit}
          style={styles.content}
        >
          <View style={styles.header}>
            <View style={styles.brand}>
              <Image source={require("./assets/icon.png")} style={styles.logo} />
              <Text style={styles.title}>Sona</Text>
            </View>
            {connection && (
              <Animated.View entering={screenEnter} exiting={screenExit}>
                <PressableScale accessibilityRole="button" hitSlop={8} onPress={disconnect}>
                  <Text style={styles.link}>Disconnect</Text>
                </PressableScale>
              </Animated.View>
            )}
          </View>
          {connection ? (
            <View style={styles.content}>
              <NativeConnection
                key={attempt}
                style={styles.content}
                connection={connection}
                backRequest={backRequest}
                onBackBoundary={() => BackHandler.exitApp()}
                onExternalLink={({ nativeEvent }) => {
                  if (/^https?:\/\//.test(nativeEvent.url))
                    void Linking.openURL(nativeEvent.url).catch(() =>
                      setMessage("No browser could open this link."),
                    );
                }}
                onState={({ nativeEvent }) => {
                  setStatus(nativeEvent.state);
                  setMessage(nativeEvent.message ?? "");
                  if (nativeEvent.state === "ready") {
                    const { endpoint, certificateFingerprint } = connection;
                    void SecureStore.setItemAsync(
                      STORAGE_KEY,
                      JSON.stringify({ endpoint, certificateFingerprint }),
                    ).catch(() =>
                      setMessage(
                        "Connected, but the connection could not be saved. You may need to scan again after closing Sona.",
                      ),
                    );
                    if (connection.credential) {
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      setConnection({ endpoint, certificateFingerprint });
                    }
                  }
                }}
              />
              {/* Overlays sit above the WebView instead of beside it, so status changes
                  never resize it and never force the workspace to reflow. */}
              {status === "loading" && (
                <Animated.View exiting={revealExit} style={styles.overlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.copy}>Connecting to your computer…</Text>
                </Animated.View>
              )}
              {status === "error" && (
                <Animated.View entering={screenEnter} exiting={screenExit} style={styles.overlay}>
                  <Animated.Text
                    entering={rise(0, reduceMotion)}
                    accessibilityRole="alert"
                    style={[styles.copy, styles.centered]}
                  >
                    {message}
                  </Animated.Text>
                  <Animated.View entering={rise(1, reduceMotion)} style={styles.actions}>
                    <PressableScale
                      accessibilityRole="button"
                      style={styles.button}
                      onPress={() => {
                        setAttempt((value) => value + 1);
                        setStatus("loading");
                      }}
                    >
                      <Text style={styles.buttonText}>Retry</Text>
                    </PressableScale>
                    <PressableScale accessibilityRole="button" onPress={() => void startScan()}>
                      <Text style={[styles.link, styles.centered]}>Scan a new code</Text>
                    </PressableScale>
                  </Animated.View>
                </Animated.View>
              )}
              {message !== "" && status !== "error" && (
                <Animated.View
                  entering={rise(0, reduceMotion, 8)}
                  exiting={screenExit}
                  style={styles.toast}
                >
                  <Pressable
                    accessibilityRole="alert"
                    accessibilityHint="Tap to dismiss"
                    onPress={() => setMessage("")}
                  >
                    <Text style={styles.toastText}>{message}</Text>
                  </Pressable>
                </Animated.View>
              )}
            </View>
          ) : (
            <View style={styles.welcome}>
              <Animated.Text entering={rise(0, reduceMotion)} style={styles.heading}>
                Your workspace, on your phone.
              </Animated.Text>
              <Animated.Text entering={rise(1, reduceMotion)} style={styles.copy}>
                Open Sona on your computer, then Settings → Connections. Enable local connections
                and scan its pairing code. Keep both devices on the same Wi-Fi.
              </Animated.Text>
              {message ? (
                <Animated.Text
                  entering={rise(0, reduceMotion, 8)}
                  exiting={screenExit}
                  accessibilityRole="alert"
                  style={styles.copy}
                >
                  {message}
                </Animated.Text>
              ) : null}
              <Animated.View entering={rise(2, reduceMotion)}>
                <PressableScale
                  accessibilityRole="button"
                  style={styles.button}
                  onPress={() => void startScan()}
                >
                  <Text style={styles.buttonText}>Scan pairing code</Text>
                </PressableScale>
              </Animated.View>
            </View>
          )}
        </Animated.View>
      )}
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Companion />
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#111111" },
  content: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { flexDirection: "row", gap: 8, alignItems: "center" },
  logo: { width: 32, height: 32 },
  title: { fontSize: 24, fontWeight: "600", color: "#fff" },
  link: { color: "#fff", padding: 12 },
  welcome: { flex: 1, justifyContent: "center", padding: 28, gap: 24 },
  heading: { fontSize: 32, fontWeight: "600", color: "#fff" },
  copy: { fontSize: 16, lineHeight: 25, color: "#dedede" },
  button: {
    minHeight: 48,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  buttonText: { fontSize: 16, fontWeight: "600", color: "#111" },
  centered: { textAlign: "center" },
  footer: { padding: 16 },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#111111",
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    gap: 16,
  },
  actions: { alignSelf: "stretch", gap: 4 },
  toast: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#222222",
    borderColor: "#333333",
    borderWidth: 1,
  },
  toastText: { fontSize: 15, lineHeight: 22, color: "#eeeeee" },
});
