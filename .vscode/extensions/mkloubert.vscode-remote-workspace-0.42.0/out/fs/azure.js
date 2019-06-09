"use strict";
/**
 * This file is part of the vscode-remote-workspace distribution.
 * Copyright (c) Marcel Joachim Kloubert.
 *
 * vscode-remote-workspace is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * vscode-remote-workspace is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const AzureStorage = require("azure-storage");
const Crypto = require("crypto");
const FS = require("fs");
const FSExtra = require("fs-extra");
const MimeTypes = require("mime-types");
const Moment = require("moment");
const Path = require("path");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
const NO_CONTINUE_TOKEN_YET = Symbol('NO_CONTINUE_TOKEN_YET');
/**
 * Azure Blob file system.
 */
class AzureBlobFileSystem extends vscrw_fs.FileSystemBase {
    /**
     * @inheritdoc
     */
    createDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            const STAT = yield this.tryGetStat(uri);
            if (false !== STAT) {
                throw vscode.FileSystemError.FileExists(uri);
            }
            yield this.writeBlob(uriWithNewPath(uri, `${toAzurePath(uri.path)}/.vscode-remote-workspace`), Buffer.alloc(0));
        });
    }
    /**
     * @inheritdoc
     */
    delete(uri, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const STAT = yield this.statInner(uri);
            let blobsToDelete = [];
            if (vscode.FileType.Directory === STAT.type) {
                const FILES = yield this.list(uri);
                const HAS_SUB_DIRS = (yield this.readDirectory(uri)).filter(e => {
                    return vscode.FileType.Directory === e[1];
                }).length > 0;
                if (!options.recursive) {
                    if (HAS_SUB_DIRS) {
                        throw vscode.FileSystemError.NoPermissions(uri);
                    }
                }
                blobsToDelete = FILES.map(i => {
                    return i.name;
                });
            }
            else {
                blobsToDelete = [uri.path];
            }
            for (const B of blobsToDelete) {
                yield this.deleteBlob(uriWithNewPath(uri, B));
            }
        });
    }
    deleteBlob(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => {
                return new Promise((resolve, reject) => {
                    const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                    try {
                        conn.client.deleteBlob(conn.container, toAzurePath(uri.path), {}, (err) => {
                            COMPLETED(err);
                        });
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                });
            });
        });
    }
    forConnection(uri, action) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const CONN = yield this.openConnection(uri);
                if (action) {
                    return yield Promise.resolve(action(CONN));
                }
            }
            catch (e) {
                this.logger
                    .trace(e, 'fs.azure.AzureBlobFileSystem.forConnection()');
                throw e;
            }
        });
    }
    getBlob(uri) {
        return this.forConnection(uri, (conn) => {
            return new Promise((resolve, reject) => {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    conn.client.getBlobMetadata(conn.container, toAzurePath(uri.path), {}, (err, result) => {
                        COMPLETED(err, result);
                    });
                }
                catch (e) {
                    COMPLETED(e);
                }
            });
        });
    }
    list(uri) {
        return this.forConnection(uri, (conn) => {
            const PATH = vscrw.normalizePath(uri.path);
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const BLOB_RESULTS = [];
                const COMPLETED = (err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(BLOB_RESULTS.filter(r => {
                            const KEY = vscode_helpers.normalizeString(r.name);
                            return '' !== KEY &&
                                '/' !== KEY;
                        }).sort((x, y) => {
                            return vscode_helpers.compareValuesBy(x, y, r => {
                                return vscode_helpers.normalizeString(r.name);
                            });
                        }));
                    }
                };
                const HANDLE_RESULT = (result) => {
                    if (!result) {
                        return;
                    }
                    vscode_helpers.asArray(result.entries).forEach(e => {
                        BLOB_RESULTS.push(e);
                    });
                };
                try {
                    let currentContinuationToken = NO_CONTINUE_TOKEN_YET;
                    const NEXT_SEGMENT = () => {
                        if (NO_CONTINUE_TOKEN_YET !== currentContinuationToken) {
                            if (!currentContinuationToken) {
                                COMPLETED(null);
                                return;
                            }
                        }
                        else {
                            currentContinuationToken = undefined;
                        }
                        conn.client.listBlobsSegmentedWithPrefix(conn.container, '/' === PATH ? '' : (toAzurePath(PATH) + '/'), currentContinuationToken, {}, (err, result) => {
                            if (err) {
                                COMPLETED(err);
                                return;
                            }
                            HANDLE_RESULT(result);
                            NEXT_SEGMENT();
                        });
                    };
                    NEXT_SEGMENT();
                }
                catch (e) {
                    COMPLETED(e);
                }
            }));
        });
    }
    openConnection(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            // format:
            //
            // azure://[account:key@][container][/path/to/file/or/folder]
            const PARAMS = vscrw.getUriParams(uri);
            let account;
            let client;
            let container;
            let host = vscode_helpers.toStringSafe(PARAMS['host']).trim();
            let key;
            let accountAndKey = false;
            {
                // external auth file?
                let authFile = vscode_helpers.toStringSafe(PARAMS['auth']);
                if (!vscode_helpers.isEmptyString(authFile)) {
                    authFile = vscrw.mapToUsersHome(authFile);
                    if (yield vscode_helpers.isFile(authFile)) {
                        accountAndKey = (yield FSExtra.readFile(authFile, 'utf8')).trim();
                    }
                }
            }
            const AUTHORITITY = vscode_helpers.toStringSafe(uri.authority);
            {
                const AUTH_HOST_SEP = AUTHORITITY.indexOf('@');
                if (AUTH_HOST_SEP > -1) {
                    if (false === accountAndKey) {
                        accountAndKey = AUTHORITITY.substr(0, AUTH_HOST_SEP);
                    }
                    container = AUTHORITITY.substr(AUTH_HOST_SEP + 1);
                }
                else {
                    container = AUTHORITITY;
                }
            }
            if (false !== accountAndKey) {
                const ACCOUNT_AND_KEY_SEP = accountAndKey.indexOf(':');
                if (ACCOUNT_AND_KEY_SEP > -1) {
                    account = accountAndKey.substr(0, ACCOUNT_AND_KEY_SEP);
                    key = accountAndKey.substr(ACCOUNT_AND_KEY_SEP + 1);
                }
                else {
                    account = accountAndKey;
                }
            }
            const IS_DEV = vscode_helpers.isEmptyString(key);
            if (IS_DEV) {
                client = AzureStorage.createBlobService('UseDevelopmentStorage=true');
                if (vscode_helpers.isEmptyString(account)) {
                    account = 'devstoreaccount1';
                }
            }
            else {
                account = vscode_helpers.toStringSafe(account).trim();
                if ('' === account) {
                    account = undefined;
                }
                key = vscode_helpers.toStringSafe(key).trim();
                if ('' === key) {
                    key = undefined;
                }
                client = AzureStorage.createBlobService(account, key, '' === host ? undefined : host);
            }
            if (vscode_helpers.isEmptyString(container)) {
                container = 'vscode-remote-workspace';
            }
            return {
                account: vscode_helpers.toStringSafe(account).trim(),
                client: client,
                container: vscode_helpers.toStringSafe(container).trim(),
            };
        });
    }
    readBlob(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => {
                return vscode_helpers.tempFile((tmpFile) => {
                    return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                        const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                        try {
                            const STREAM = FS.createWriteStream(tmpFile);
                            conn.client.getBlobToStream(conn.container, toAzurePath(uri.path), STREAM, (err) => {
                                if (err) {
                                    COMPLETED(err);
                                    return;
                                }
                                try {
                                    FSExtra.readFile(tmpFile).then((data) => {
                                        COMPLETED(null, data);
                                    }, (err) => {
                                        COMPLETED(err);
                                    });
                                }
                                catch (e) {
                                    COMPLETED(e);
                                }
                            });
                        }
                        catch (e) {
                            COMPLETED(e);
                        }
                    }));
                }, {
                    keep: false,
                });
            });
        });
    }
    /**
     * @inheritdoc
     */
    readDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const PATH = vscrw.normalizePath(uri.path);
                const PATH_PARTS = PATH.split('/').filter(x => {
                    return !vscode_helpers.isEmptyString(x);
                });
                const ENTRIES = [];
                const LIST = yield this.list(uri);
                const DIRS = [];
                for (const ITEM of LIST) {
                    const KEY = vscode_helpers.toStringSafe(ITEM.name);
                    const KEY_PARTS = KEY.split('/').filter(x => {
                        return !vscode_helpers.isEmptyString(x);
                    });
                    if (PATH_PARTS.length === (KEY_PARTS.length - 1)) {
                        ENTRIES.push([
                            ITEM.name, vscode.FileType.File
                        ]);
                    }
                    else if (KEY_PARTS.length >= PATH_PARTS.length) {
                        const D = vscode_helpers.from(KEY_PARTS)
                            .take(PATH_PARTS.length + 1)
                            .joinToString('/');
                        if (DIRS.indexOf(D) < 0) {
                            DIRS.push(D);
                            ENTRIES.push([
                                D, vscode.FileType.Directory
                            ]);
                        }
                    }
                }
                return vscode_helpers.from(ENTRIES).orderBy(e => {
                    return vscode.FileType.Directory === e[1] ? 0 : 1;
                }).thenBy(e => {
                    return vscode_helpers.normalizeString(e[0]);
                }).toArray();
            }));
        });
    }
    /**
     * @inheritdoc
     */
    readFile(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.readBlob(uri);
        });
    }
    /**
     * Register file system to extension.
     *
     * @param {vscode.ExtensionContext} context The extension context.
     *
     * @return {AzureBlobFileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new AzureBlobFileSystem();
        try {
            context.subscriptions.push(vscode.workspace.registerFileSystemProvider(AzureBlobFileSystem.scheme, NEW_FS, { isCaseSensitive: true }));
        }
        catch (e) {
            vscode_helpers.tryDispose(NEW_FS);
            throw e;
        }
        return NEW_FS;
    }
    /**
     * @inheritdoc
     */
    rename(oldUri, newUri, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(oldUri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const COPY_BLOB = (from, to) => __awaiter(this, void 0, void 0, function* () {
                    yield this.writeBlob(uriWithNewPath(oldUri, to), yield this.readBlob(uriWithNewPath(oldUri, from)));
                });
                const DELETE_BLOB = (blob) => __awaiter(this, void 0, void 0, function* () {
                    yield this.deleteBlob(uriWithNewPath(oldUri, blob));
                });
                const OLD_STAT = yield this.statInner(oldUri);
                const NEW_STAT = yield this.tryGetStat(newUri);
                if (false !== NEW_STAT) {
                    if (!options.overwrite) {
                        throw vscode.FileSystemError.FileExists(newUri);
                    }
                    if (vscode.FileType.File === NEW_STAT.type) {
                        yield DELETE_BLOB(newUri.path);
                    }
                }
                const ITEMS_TO_MOVE = [];
                if (vscode.FileType.Directory === OLD_STAT.type) {
                    const LIST = yield this.list(oldUri);
                    const OLD_DIR = toAzurePath(oldUri.path) + '/';
                    const NEW_DIR = toAzurePath(newUri.path) + '/';
                    for (const ITEM of LIST) {
                        const OLD_PATH = ITEM.name;
                        const NEW_PATH = NEW_DIR + OLD_PATH.substr(OLD_DIR.length);
                        ITEMS_TO_MOVE.push({
                            oldPath: OLD_PATH,
                            newPath: NEW_PATH,
                        });
                    }
                }
                else {
                    ITEMS_TO_MOVE.push({
                        oldPath: oldUri.path,
                        newPath: newUri.path,
                    });
                }
                for (const I of ITEMS_TO_MOVE) {
                    yield COPY_BLOB(I.oldPath, I.newPath);
                    yield DELETE_BLOB(I.oldPath);
                }
            }));
        });
    }
    /**
     * @inheritdoc
     */
    stat(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.statInner(uri);
        });
    }
    statInner(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            if ('/' === vscrw.normalizePath(uri.path)) {
                return {
                    type: vscode.FileType.Directory,
                    ctime: 0,
                    mtime: 0,
                    size: 0,
                };
            }
            return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const PATH = vscrw.normalizePath(uri.path);
                let result = false;
                try {
                    const BLOB = yield this.getBlob(uri);
                    if (BLOB) {
                        result = {
                            ctime: undefined,
                            mtime: undefined,
                            size: parseInt(vscode_helpers.normalizeString(BLOB.contentLength)),
                            type: vscode.FileType.File,
                        };
                        if (!vscode_helpers.isEmptyString(BLOB.lastModified)) {
                            let mtime = Moment(BLOB.lastModified);
                            if (mtime.isValid()) {
                                result.mtime = vscode_helpers.asUTC(mtime).unix();
                            }
                        }
                    }
                }
                catch (_a) { }
                if (false === result) {
                    const LIST = yield this.list(uri);
                    if (LIST.length > 0) {
                        result = {
                            ctime: undefined,
                            mtime: undefined,
                            size: undefined,
                            type: vscode.FileType.Directory,
                        };
                    }
                }
                if (false === result) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
                if (isNaN(result.mtime)) {
                    result.mtime = 0;
                }
                result.ctime = result.mtime;
                if (isNaN(result.size)) {
                    result.size = 0;
                }
                return result;
            }));
        });
    }
    tryGetStat(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            let stat;
            try {
                stat = yield this.statInner(uri);
            }
            catch (_a) {
                stat = false;
            }
            return stat;
        });
    }
    /**
     * @inheritdoc
     */
    watch(uri, options) {
        // TODO: implement
        return {
            dispose: () => {
            }
        };
    }
    writeBlob(uri, data) {
        return __awaiter(this, void 0, void 0, function* () {
            const PATH = toAzurePath(uri.path);
            yield this.forConnection(uri, (conn) => {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                    try {
                        let contentType = MimeTypes.lookup(Path.basename(PATH));
                        if (false === contentType) {
                            contentType = 'application/octet-stream';
                        }
                        const MD5 = Crypto.createHash('md5')
                            .update(data).digest('base64');
                        conn.client.createBlockBlobFromText(conn.container, PATH, data, {
                            contentSettings: {
                                contentMD5: MD5,
                                contentType: contentType,
                            }
                        }, (err) => {
                            COMPLETED(err);
                        });
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                }));
            });
        });
    }
    /**
     * @inheritdoc
     */
    writeFile(uri, content, options) {
        return __awaiter(this, void 0, void 0, function* () {
            this.throwIfWriteFileIsNotAllowed(yield this.tryGetStat(uri), options, uri);
            yield this.writeBlob(uri, vscrw.asBuffer(content));
        });
    }
}
/**
 * Stores the name of the scheme.
 */
AzureBlobFileSystem.scheme = 'azure';
exports.AzureBlobFileSystem = AzureBlobFileSystem;
function toAzurePath(p) {
    return vscrw.normalizePath(p)
        .substr(1);
}
function uriWithNewPath(uri, newPath) {
    if (uri) {
        return vscode.Uri.parse(`azure://${uri.authority}/${toAzurePath(newPath)}${vscode_helpers.isEmptyString(uri.query) ? '' : ('?' + uri.query)}`);
    }
}
//# sourceMappingURL=azure.js.map