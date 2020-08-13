import * as vsls from 'vsls/vscode'
import * as vscode from 'vscode'
import {Uri} from 'vscode'


export class VslsFileSystem {
    private readonly _vslsApi: Promise<vsls.LiveShare | null>
    service: vsls.SharedService | null = null

    constructor() {
        this._vslsApi = vsls.getApi()
    }

    async start() {
        const vslsApi = await this.vslsApi()
        vslsApi.onDidChangeSession(() => {
            this.startService()
        })
        return this.startService()
    }

    private async startService() {
        const vslsApi = await this.vslsApi()
        const role = vslsApi.session.role
        if (role === vsls.Role.Host) {
            return this.startFileSystemServiceOnHost()
        } else if (role === vsls.Role.Guest) {
            return this.startFileSystemProviderOnGuest()
        }
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
        const uri = Uri.parse(uriStr)
        if (uri.scheme !== 'vslsfs') {
            throw new Error()
        }
        const vslsUri = uri.with({scheme: 'vsls'})
        const path = vslsApi?.convertSharedUriToLocal(vslsUri)
        return path
    }

    async startFileSystemServiceOnHost() {
        const vslsApi = await this.vslsApi()
        const service = await vslsApi.shareService('vslsfs')
        this.service = service
        if (!service) {
            throw new Error()
        }
        service.onRequest('readFile', async ([uriStr]: [unknown]) => {
            const path = await this.uriToPath(uriStr)
            const data = await vscode.workspace.fs.readFile(path)
            return data
        })
    }

    async startFileSystemProviderOnGuest() {
        throw new Error()
    }

}

export class VslsfsProvider implements vscode.FileSystemProvider {
    private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

    constructor(private readonly service: vsls.SharedServiceProxy) {
        this.onDidChangeFile = this.emitter.event
    }

    copy(source: Uri, destination: Uri, options: { overwrite: boolean }): Promise<void> {
        return this.service.request('copy', [source, destination, options])
    }

    async createDirectory(uri: Uri): Promise<void> {
        return this.service.request('createDirectory', [uri])
    }

    delete(uri: Uri, options: { recursive: boolean }): Promise<void> {
        return this.service.request('delete', [uri, options])
    }

    async readFile(uri: Uri): Promise<Uint8Array> {
        return this.service.request('readFile', [uri])
    }

    async readDirectory(uri: Uri): Promise<[string, vscode.FileType][]> {
        return this.service.request('readDirectory', [uri])
    }

    async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): Promise<void> {
        return this.service.request('rename', [oldUri, newUri, options])
    }

    async stat(uri: Uri): Promise<vscode.FileStat> {
        return this.service.request('stat', [uri])
    }

    watch(uri: Uri, options: { recursive: boolean; excludes: string[] }) {
        return this.service.request('watch', [uri, options]) as any
    }

    writeFile(uri: Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
        return this.service.request('writeFile', [uri, content, options])
    }
}
