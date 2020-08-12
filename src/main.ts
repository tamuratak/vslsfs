import * as vsls from 'vsls/vscode'
import * as vscode from 'vscode'


export class VslsFileSystem {
    private readonly _vslsApi: Promise<vsls.LiveShare | null>
    service: vsls.SharedService | null

    constructor() {
        this._vslsApi = vsls.getApi()
    }

    async vslsApi() {
        const api = await this._vslsApi
        if (!api) {
            throw new Error()
        }
        return api
    }

    workspaceFolder() {
        const ret = vscode.workspace.workspaceFolders?.[0]
        if (!ret) {
            throw new Error()
        }
        return ret
    }

    async uriToPath(uriStr: unknown) {
        const vslsApi = await this.vslsApi()
        if (typeof uriStr !== 'string') {
            throw new Error()
        }
        const uri = vscode.Uri.parse(uriStr)
        const path = vslsApi?.convertSharedUriToLocal(uri)
        return path
    }

    async registerFileSystemProviderOnHost() {
        const vslsApi = await this.vslsApi()
        const service = await vslsApi.shareService('vslsfs')
        this.service = service
        if (!service) {
            throw new Error()
        }
        service.onRequest('readFile', async ([uriStr]: [unknown]) => {
            const path = await this.uriToPath(uriStr)
            const data = await vscode.workspace.fs.readFile(path)
            const buf = Buffer.from(data)
            return buf
        })
    }

}


