/** User-agent token appended by the Sona Android app's WebView (apps/mobile SonaConnectionModule). */
export const ANDROID_APP_USER_AGENT_TOKEN = "SonaAndroid";

const ANDROID_APP_USER_AGENT = new RegExp(`(?:^|\\s)${ANDROID_APP_USER_AGENT_TOKEN}/\\S+`);

/** True when the workspace is rendered inside the Sona Android app rather than a browser. */
export function isAndroidAppUserAgent(userAgent: string): boolean {
  return ANDROID_APP_USER_AGENT.test(userAgent);
}
