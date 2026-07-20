import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "ブックマーク受信箱",
  description: "フォルダ選択なしでページを一旦保存し、未処理件数をバッジ表示します。",
  version: pkg.version,
  permissions: ["storage", "activeTab", "contextMenus"],
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
});
