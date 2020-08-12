import * as vsls from 'vsls/vscode'
import * as vscode from 'vscode'


export function workspaceFolder() {
    const ret = vscode.workspace.workspaceFolders?.[0]
    if (!ret) {
        throw new Error()
    }
    return ret
}

export async function registerFileSystemProviderOnHost() {
    const vslsApi = await vsls.getApi()
    if (!vslsApi) {
        return
    }
    const service = await vslsApi.shareService('vslsfs')
    if (!service) {
        return
    }
    service.onRequest('readFile', async ([uriStr]: [unknown]) => {
        if (typeof uriStr !== 'string') {
            return
        }
        const uri = vscode.Uri.parse(uriStr)
        const path = vslsApi.convertSharedUriToLocal(uri)
        const data = await vscode.workspace.fs.readFile(path)
        const buf = Buffer.from(data)
        return buf
    })
}


