import { ipcMain, dialog, shell } from 'electron'

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

  ipcMain.handle('shell:show-in-folder', async (_event, folderPath: string) => {
    shell.showItemInFolder(folderPath)
  })
}
