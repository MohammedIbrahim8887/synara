import { version } from "../package.json" with { type: "json" };

declare const __SONA_RELEASE_VERSION__: string | undefined;

const sonaReleaseVersion =
  typeof __SONA_RELEASE_VERSION__ === "undefined" ? undefined : __SONA_RELEASE_VERSION__;

export const isSonaRelease = sonaReleaseVersion !== undefined;
export const buildVersion = sonaReleaseVersion ?? version;
