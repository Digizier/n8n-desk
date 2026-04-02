import { ipcMain, dialog, shell } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('dialog:open-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Supported files',
          extensions: [
            'csv', 'xlsx', 'xls',
            'json', 'jsonl',
            'yaml', 'yml',
            'txt', 'md', 'log',
            'pdf',
            'docx',
            'xml', 'html', 'svg',
            'toml',
          ],
        },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths
  })

  /**
   * Open a file dialog and return files as base64-encoded ChatAttachment objects.
   * Accepts an optional MIME type filter string (comma-separated, e.g. "image/*,text/*").
   */
  ipcMain.handle(
    'dialog:open-files-as-attachments',
    async (_event, allowedMimeTypes?: string) => {
      const filters: Electron.FileFilter[] = []

      if (allowedMimeTypes && allowedMimeTypes !== '*/*') {
        // Convert MIME patterns to file extensions for Electron's dialog
        const extensions = mimeFilterToExtensions(allowedMimeTypes)
        if (extensions.length > 0) {
          filters.push({ name: 'Allowed files', extensions })
        }
      }

      // Always add an "All files" option as fallback
      filters.push({ name: 'All files', extensions: ['*'] })

      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters,
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      const attachments: Array<{ data: string; mimeType: string; fileName: string }> = []

      for (const filePath of result.filePaths) {
        const buffer = await readFile(filePath)
        const fileName = basename(filePath)
        const mimeType = extToMime(extname(filePath).toLowerCase())
        const data = `data:${mimeType};base64,${buffer.toString('base64')}`
        attachments.push({ data, mimeType, fileName })
      }

      return attachments
    },
  )

  ipcMain.handle('shell:show-in-folder', async (_event, folderPath: string) => {
    shell.showItemInFolder(folderPath)
  })
}

/** Map a file extension to a MIME type. */
function extToMime(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.jsonl': 'application/jsonl',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.log': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'text/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.toml': 'text/plain',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
  }
  return map[ext] ?? 'application/octet-stream'
}

/** Map a comma-separated MIME type filter (e.g. "image/*,text/plain,application/pdf") to file extensions. */
function mimeFilterToExtensions(mimeFilter: string): string[] {
  const MIME_CATEGORY_MAP: Record<string, string[]> = {
    'image/*': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
    'text/*': ['txt', 'md', 'csv', 'log', 'html', 'xml', 'json', 'yaml', 'yml', 'toml'],
    'audio/*': ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
    'video/*': ['mp4', 'webm', 'mov', 'avi', 'mkv'],
    'application/pdf': ['pdf'],
    'application/json': ['json'],
    'text/csv': ['csv'],
    'text/plain': ['txt', 'log', 'md'],
    'text/html': ['html', 'htm'],
    'text/xml': ['xml'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  }

  const extensions = new Set<string>()
  for (const pattern of mimeFilter.split(',').map((s) => s.trim())) {
    if (pattern === '*' || pattern === '*/*') continue
    const mapped = MIME_CATEGORY_MAP[pattern]
    if (mapped) {
      mapped.forEach((e) => extensions.add(e))
    }
  }
  return [...extensions]
}
