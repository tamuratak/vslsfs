import * as vsls from 'vsls/vscode'
import * as vscode from 'vscode'
import {Uri} from 'vscode'

function assertString(str: unknown): asserts str is string {
    if (typeof str !== 'string') {
        throw new Error()
    }
}

export class VslsFileSystem {
    private readonly _vslsApi: Promise<vsls.LiveShare | null>
    serviceOnHost: vsls.SharedService | null = null
    serviceOnGuest: vsls.SharedServiceProxy | null = null

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

    async uriToPath(uriStr: string) {
        const vslsApi = await this.vslsApi()
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
        this.serviceOnHost = service
        if (!service) {
            throw new Error()
        }
        service.onRequest('readFile', async ([uriStr]: [unknown]) => {
            assertString(uriStr)
            const path = await this.uriToPath(uriStr)
            const data = await vscode.workspace.fs.readFile(path)
            return data
        })
    }

    async startFileSystemProviderOnGuest() {
        const vslsApi = await this.vslsApi()
        const service = await vslsApi.getSharedService('vslsfs')
        this.serviceOnGuest = service
        if (!service) {
            throw new Error()
        }
        const provider = new VslsfsProvider(service)
        vscode.workspace.registerFileSystemProvider('vslsfs', provider)
    }

}

export class VslsfsProvider implements vscode.FileSystemProvider {
    private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

    constructor(private readonly service: vsls.SharedServiceProxy) {
        this.onDidChangeFile = this.emitter.event
    }

    copy(source: Uri, destination: Uri, options: { overwrite: boolean }): Promise<void> {
        const srcUri = source.toString(true)
        const dstUri = destination.toString(true)
        return this.service.request('copy', [srcUri, dstUri, options])
    }

    async createDirectory(uri: Uri): Promise<void> {
        const uriStr = uri.toString(true)
        return this.service.request('createDirectory', [uriStr])
    }

    delete(uri: Uri, options: { recursive: boolean }): Promise<void> {
        const uriStr = uri.toString(true)
        return this.service.request('delete', [uriStr, options])
    }

    async readFile(uri: Uri): Promise<Uint8Array> {
        const uriStr = uri.toString(true)
        return this.service.request('readFile', [uriStr])
    }

    async readDirectory(uri: Uri): Promise<[string, vscode.FileType][]> {
        const uriStr = uri.toString(true)
        return this.service.request('readDirectory', [uriStr])
    }

    async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): Promise<void> {
        const oldUriStr = oldUri.toString(true)
        const newUriStr = newUri.toString(true)
        return this.service.request('rename', [oldUriStr, newUriStr, options])
    }

    async stat(uri: Uri): Promise<vscode.FileStat> {
        const uriStr = uri.toString(true)
        return this.service.request('stat', [uriStr])
    }

    watch(uri: Uri, options: { recursive: boolean; excludes: string[] }) {
        const uriStr = uri.toString(true)
        return this.service.request('watch', [uriStr, options]) as any
    }

    writeFile(uri: Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
        const uriStr = uri.toString(true)
        return this.service.request('writeFile', [uriStr, content, options])
    }
}
