import * as vsls from 'vsls/vscode'
import * as vscode from 'vscode'
import {Uri} from 'vscode'


function assertString(str: unknown): asserts str is string {
    if (typeof str !== 'string') {
        throw new Error()
    }
}

function assertUint8Array(data: unknown): asserts data is Uint8Array {
    if (data instanceof Uint8Array) {
        return
    } else {
        throw new Error()
    }
}

export class VslsFileSystem {
    private readonly _vslsApi: Promise<vsls.LiveShare | null>
    serviceOnHost: vsls.SharedService | null = null
    serviceOnGuest: vsls.SharedServiceProxy | null = null
    watcher?: vscode.FileSystemWatcher

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
        const folder = this.workspaceFolder()
        const pattern = new vscode.RelativePattern(folder, '**/*')
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        this.watcher = watcher

        service.onRequest('copy', async ([srcUriStr, dstUriStr, options]: [unknown, unknown, { overwrite?: boolean}]) => {
            assertString(srcUriStr)
            assertString(dstUriStr)
            const src = await this.uriToPath(srcUriStr)
            const dst = await this.uriToPath(dstUriStr)
            vscode.workspace.fs.copy(src, dst, { overwrite: options?.overwrite })
        })

        service.onRequest('createDirectory', async ([uriStr]: [unknown]) => {
            assertString(uriStr)
            const path = await this.uriToPath(uriStr)
            await vscode.workspace.fs.createDirectory(path)
        })

        service.onRequest('delete', async ([uriStr, options]: [unknown, { recursive?: boolean, useTrash?: boolean }]) => {
            assertString(uriStr)
            const path = await this.uriToPath(uriStr)
            await vscode.workspace.fs.delete(
                path,
                { recursive: options?.recursive, useTrash: options?.useTrash }
            )
        })

        service.onRequest('readFile', async ([uriStr]: [unknown]) => {
            assertString(uriStr)
            const path = await this.uriToPath(uriStr)
            const data = await vscode.workspace.fs.readFile(path)
            return data
        })

        service.onRequest('readDirectory', async ([uriStr]: [unknown]) => {
            assertString(uriStr)
            const path = await this.uriToPath(uriStr)
            const ret = await vscode.workspace.fs.readDirectory(path)
            return ret
        })

        service.onRequest('rename', async ([oldUriStr, newUriStr, options]: [unknown, unknown, { overwrite?: boolean }]) => {
            assertString(oldUriStr)
            assertString(newUriStr)
            const oldUri = await this.uriToPath(oldUriStr)
            const newUri = await this.uriToPath(newUriStr)
            await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: options?.overwrite })
        })

        service.onRequest('stat', async ([uriStr]: [unknown]) => {
            assertString(uriStr)
            const path = await this.uriToPath(uriStr)
            const ret = await vscode.workspace.fs.stat(path)
            return ret
        })

        service.onRequest('watch', async ([uriStr]: [unknown]) => {
            assertString(uriStr)
            const path = await this.uriToPath(uriStr)
            if (!this.watcher) {
                throw new Error()
            }
            this.watcher.onDidChange((e) => {
                if (e.fsPath === path.fsPath) {
                    service.notify('change', { uri: uriStr, type: vscode.FileChangeType.Changed })
                }
            })
        })

        service.onRequest('writeFile', async ([uriStr, content]: [unknown, unknown]) => {
            assertString(uriStr)
            assertUint8Array(content)
            const path = await this.uriToPath(uriStr)
            await vscode.workspace.fs.writeFile(path, content)
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
    private readonly service: vsls.SharedServiceProxy
    private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

    constructor(service: vsls.SharedServiceProxy) {
        this.service = service
        this.onDidChangeFile = this.emitter.event
        this.service.onNotify('change', (ev: { uri: string, type: vscode.FileChangeType }) => {
            const uri = Uri.parse(ev.uri)
            this.emitter.fire([{ uri, type: ev.type }])
        })
    }

    copy(source: Uri, destination: Uri, options: { overwrite: boolean }): Promise<void> {
        const srcUri = source.toString(true)
        const dstUri = destination.toString(true)
        return this.service.request('copy', [srcUri, dstUri, options])
    }

    createDirectory(uri: Uri): Promise<void> {
        const uriStr = uri.toString(true)
        return this.service.request('createDirectory', [uriStr])
    }

    delete(uri: Uri, options: { recursive?: boolean, useTrash?: boolean }): Promise<void> {
        const uriStr = uri.toString(true)
        return this.service.request('delete', [uriStr, options])
    }

    readFile(uri: Uri): Promise<Uint8Array> {
        const uriStr = uri.toString(true)
        return this.service.request('readFile', [uriStr])
    }

    readDirectory(uri: Uri): Promise<[string, vscode.FileType][]> {
        const uriStr = uri.toString(true)
        return this.service.request('readDirectory', [uriStr])
    }

    rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): Promise<void> {
        const oldUriStr = oldUri.toString(true)
        const newUriStr = newUri.toString(true)
        return this.service.request('rename', [oldUriStr, newUriStr, options])
    }

    stat(uri: Uri): Promise<vscode.FileStat> {
        const uriStr = uri.toString(true)
        return this.service.request('stat', [uriStr])
    }

    watch(uri: Uri, options: { recursive: boolean; excludes: string[] }) {
        const uriStr = uri.toString(true)
        return this.service.request('watch', [uriStr, options]) as any
    }

    writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        const uriStr = uri.toString(true)
        return this.service.request('writeFile', [uriStr, content])
    }
}
