import { Updater, Utils } from "electrobun/main";
import { isUpdateVersionNewer } from "../../src/updateState";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
let checking = false;

export async function checkForSonaUpdates(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const current = await Updater.getLocalInfo();
    const update = await Updater.checkForUpdate();
    if (update.error) throw new Error(update.error);
    if (
      !update.updateAvailable ||
      !stableVersion.test(update.version) ||
      !stableVersion.test(current.version) ||
      !isUpdateVersionNewer(current.version, update.version)
    ) {
      await Utils.showMessageBox({
        title: "Sona Updates",
        message: `Sona ${current.version} is up to date.`,
      });
      return;
    }
    if (!update.updateReady) {
      const { response } = await Utils.showMessageBox({
        type: "question",
        title: "Sona Updates",
        message: `Sona ${update.version} is available.`,
        buttons: ["Download", "Cancel"],
        cancelId: 1,
      });
      if (response !== 0) return;
      await Updater.downloadUpdate();
      const downloaded = Updater.updateInfo();
      if (!downloaded.updateReady) {
        throw new Error(downloaded.error || "The update did not finish downloading.");
      }
    }
    const { response } = await Utils.showMessageBox({
      type: "question",
      title: "Sona Updates",
      message: `Restart Sona to install ${update.version}?`,
      detail: "Finish any active agent work before restarting.",
      buttons: ["Install and Restart", "Later"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
    await Updater.applyUpdate();
    const { error } = Updater.updateInfo();
    if (error) throw new Error(error);
  } catch (error) {
    console.error("Sona update failed:", error);
    await Utils.showMessageBox({
      type: "error",
      title: "Sona Updates",
      message: "Sona could not check for or install the update.",
      detail: error instanceof Error ? error.message : undefined,
    });
  } finally {
    checking = false;
  }
}
