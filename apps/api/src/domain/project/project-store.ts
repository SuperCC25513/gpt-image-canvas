export {
  deleteGalleryOutput,
  ensureDefaultProject,
  getGalleryExportAssets,
  getGalleryImages,
  getPublicGalleryImages,
  getProjectState,
  saveProjectSnapshot,
  updateGalleryVisibility
} from "../storage/store.js";

export type { GalleryExportAsset, ProjectSnapshotInput } from "../storage/store.js";
