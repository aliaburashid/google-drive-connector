import { ConnectorError } from "../errors/normalize.js";

/** Friendly export aliases owned by the connector — callers cannot pass arbitrary MIME types. */
export const EXPORT_FORMAT_ALIASES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  epub: "application/epub+zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  png: "image/png",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
} as const;

export type ExportFormatAlias = keyof typeof EXPORT_FORMAT_ALIASES;

export const EXPORT_FORMAT_ALIAS_LIST = Object.keys(
  EXPORT_FORMAT_ALIASES,
) as ExportFormatAlias[];

const DOCUMENT = "application/vnd.google-apps.document";
const SPREADSHEET = "application/vnd.google-apps.spreadsheet";
const PRESENTATION = "application/vnd.google-apps.presentation";
const DRAWING = "application/vnd.google-apps.drawing";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";

/** Allowed aliases per Workspace source type (Google export MIME table). */
export const ALLOWED_EXPORT_FORMATS: Record<string, readonly ExportFormatAlias[]> = {
  [DOCUMENT]: ["pdf", "docx", "odt", "rtf", "txt", "md", "epub"],
  [SPREADSHEET]: ["pdf", "xlsx", "ods", "csv", "tsv"],
  [PRESENTATION]: ["pdf", "pptx", "odp", "txt", "png", "jpeg", "svg"],
  [DRAWING]: ["pdf", "png", "jpeg", "svg"],
};

export const DEFAULT_EXPORT_FORMAT: Record<string, ExportFormatAlias> = {
  [DOCUMENT]: "pdf",
  [SPREADSHEET]: "xlsx",
  [PRESENTATION]: "pdf",
  [DRAWING]: "pdf",
};

export const GOOGLE_EXPORT_LIMIT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_BYTES = GOOGLE_EXPORT_LIMIT_BYTES;
export const ABSOLUTE_MAX_BYTES = 25 * 1024 * 1024;

export function isGoogleWorkspaceMimeType(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps.");
}

export function isNonExportableWorkspaceType(mimeType: string): boolean {
  return mimeType === FOLDER || mimeType === SHORTCUT;
}

export function resolveExport(
  sourceMimeType: string,
  format?: ExportFormatAlias,
): { alias: ExportFormatAlias; mimeType: string } {
  if (isNonExportableWorkspaceType(sourceMimeType)) {
    throw new ConnectorError({
      code: "unsupported_file_type",
      message: `Cannot read or export a Google Workspace type of ${sourceMimeType}`,
      retryClass: "fatal",
    });
  }

  const allowed = ALLOWED_EXPORT_FORMATS[sourceMimeType];
  const defaultAlias = DEFAULT_EXPORT_FORMAT[sourceMimeType];
  if (!allowed || !defaultAlias) {
    throw new ConnectorError({
      code: "unsupported_export_type",
      message: `No connector-supported export mapping for ${sourceMimeType}`,
      retryClass: "fatal",
    });
  }

  const alias = format ?? defaultAlias;
  if (!allowed.includes(alias)) {
    throw new ConnectorError({
      code: "unsupported_export_type",
      message: `Format "${alias}" is not supported for ${sourceMimeType}. Allowed: ${allowed.join(", ")}`,
      retryClass: "fatal",
    });
  }

  return { alias, mimeType: EXPORT_FORMAT_ALIASES[alias] };
}

export function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "image/svg+xml"
  );
}
