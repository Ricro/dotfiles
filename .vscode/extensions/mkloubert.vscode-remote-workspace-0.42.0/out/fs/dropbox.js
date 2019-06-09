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
const Dropbox = require("dropbox");
const FSExtra = require("fs-extra");
const IsomorphicFetch = require('isomorphic-fetch'); // REQUIRED EXTENSION FOR dropbox MODULE!!!
const Moment = require("moment");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
const NO_CURSOR_YET = Symbol('NO_CURSOR_YET');
/**
 * Dropbox file system.
 */
class DropboxFileSystem extends vscrw_fs.FileSystemBase {
    /**
     * @inheritdoc
     */
    copy(source, destination, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(source, (conn) => __awaiter(this, void 0, void 0, function* () {
                const SRC_STAT = yield this.statInner(source);
                const DEST_STAT = yield this.tryGetStat(source);
                if (false !== DEST_STAT) {
                    if (options.overwrite) {
                        yield conn.client.filesDeleteV2({
                            path: toDropboxPath(destination.path),
                        });
                    }
                    else {
                        throw vscode.FileSystemError.FileExists(destination);
                    }
                }
                yield conn.client.filesCopyV2({
                    from_path: toDropboxPath(source.path),
                    to_path: toDropboxPath(destination.path),
                });
            }));
        });
    }
    /**
     * @inheritdoc
     */
    createDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const STAT = yield this.tryGetStat(uri);
                if (false !== STAT) {
                    throw vscode.FileSystemError.FileExists(uri);
                }
                yield conn.client.filesCreateFolderV2({
                    autorename: false,
                    path: toDropboxPath(uri.path),
                });
            }));
        });
    }
    /**
     * @inheritdoc
     */
    delete(uri, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const STAT = yield this.statInner(uri);
                if (vscode.FileType.Directory === STAT.type) {
                    if (!options.recursive) {
                        const LIST = yield this.list(uri);
                        const HAS_SUB_DIRS = LIST.filter(i => {
                            return 'folder' === vscode_helpers.normalizeString(i['.tag']);
                        }).length > 0;
                        if (HAS_SUB_DIRS) {
                            throw vscode.FileSystemError.NoPermissions(uri);
                        }
                    }
                }
                yield conn.client.filesDeleteV2({
                    path: toDropboxPath(uri.path)
                });
            }));
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
                    .trace(e, 'fs.dropbox.DropboxFileSystem.forConnection()');
                throw e;
            }
        });
    }
    list(uri) {
        return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
            const ALL_ENTRIES = [];
            let cursor = NO_CURSOR_YET;
            const NEXT_SEGMENT = () => __awaiter(this, void 0, void 0, function* () {
                let result;
                if (cursor === NO_CURSOR_YET) {
                    result = yield conn.client.filesListFolder({
                        include_media_info: true,
                        include_mounted_folders: true,
                        path: toDropboxPath(uri.path),
                        recursive: false,
                    });
                }
                else {
                    result = yield conn.client.filesListFolderContinue({
                        cursor: cursor,
                    });
                }
                vscode_helpers.asArray(result.entries).forEach(e => {
                    ALL_ENTRIES.push(e);
                });
                if (result.has_more) {
                    cursor = result.cursor;
                    if (!vscode_helpers.isEmptyString(cursor)) {
                        yield NEXT_SEGMENT();
                    }
                }
            });
            yield NEXT_SEGMENT();
            return ALL_ENTRIES;
        }));
    }
    openConnection(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            // format:
            //
            // dropbox://token[/path/to/file/or/folder]
            const PARAMS = vscrw.getUriParams(uri);
            let accessToken = false;
            {
                // external auth file?
                let authFile = vscode_helpers.toStringSafe(PARAMS['auth']);
                if (!vscode_helpers.isEmptyString(authFile)) {
                    authFile = vscrw.mapToUsersHome(authFile);
                    if (yield vscode_helpers.isFile(authFile)) {
                        accessToken = (yield FSExtra.readFile(authFile, 'utf8')).trim();
                    }
                }
            }
            if (false === accessToken) {
                accessToken = vscode_helpers.toStringSafe(uri.authority).trim();
            }
            if (vscode_helpers.isEmptyString(accessToken)) {
                accessToken = undefined;
            }
            return {
                client: new Dropbox.Dropbox({
                    accessToken: accessToken
                }),
            };
        });
    }
    /**
     * @inheritdoc
     */
    readDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            const ENTRIES = [];
            const LIST = yield this.list(uri);
            for (const ITEM of LIST) {
                if (vscode_helpers.isEmptyString(ITEM.name)) {
                    continue;
                }
                let type = vscode.FileType.Unknown;
                const TAG = vscode_helpers.normalizeString(ITEM['.tag']);
                if ('file' === TAG) {
                    type = vscode.FileType.File;
                }
                else if ('folder' === TAG) {
                    type = vscode.FileType.Directory;
                }
                ENTRIES.push([
                    vscode_helpers.toStringSafe(ITEM.name), type
                ]);
            }
            return ENTRIES;
        });
    }
    /**
     * @inheritdoc
     */
    readFile(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const DATA = yield conn.client.filesDownload({
                        path: toDropboxPath(uri.path)
                    });
                    return DATA['fileBinary'];
                }
                catch (_a) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
            }));
        });
    }
    /**
     * Register file system to extension.
     *
     * @param {vscode.ExtensionContext} context The extension context.
     *
     * @return {DropboxFileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new DropboxFileSystem();
        try {
            context.subscriptions.push(vscode.workspace.registerFileSystemProvider(DropboxFileSystem.scheme, NEW_FS, { isCaseSensitive: false }));
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
                const STAT = yield this.tryGetStat(newUri);
                if (false !== STAT) {
                    if (options.overwrite) {
                        yield conn.client.filesDeleteV2({
                            path: toDropboxPath(newUri.path),
                        });
                    }
                    else {
                        throw vscode.FileSystemError.FileExists(newUri);
                    }
                }
                yield conn.client.filesMoveV2({
                    from_path: toDropboxPath(oldUri.path),
                    to_path: toDropboxPath(newUri.path),
                });
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
                try {
                    const META = yield conn.client.filesGetMetadata({
                        include_media_info: false,
                        path: toDropboxPath(uri.path)
                    });
                    const STAT = {
                        ctime: undefined,
                        mtime: undefined,
                        size: undefined,
                        type: vscode.FileType.Unknown,
                    };
                    const TAG = vscode_helpers.normalizeString(META['.tag']);
                    if ('file' === TAG) {
                        const FILE_META = META;
                        STAT.type = vscode.FileType.File;
                        STAT.size = parseInt(vscode_helpers.toStringSafe(FILE_META.size).trim());
                        if (!vscode_helpers.isEmptyString(FILE_META.server_modified)) {
                            let mtime = Moment(FILE_META.server_modified);
                            if (mtime.isValid()) {
                                mtime = vscode_helpers.asUTC(mtime);
                                STAT.mtime = mtime.unix();
                            }
                        }
                    }
                    else if ('folder' === TAG) {
                        const FOLDER_META = META;
                        STAT.type = vscode.FileType.Directory;
                    }
                    if (isNaN(STAT.mtime)) {
                        STAT.mtime = 0;
                    }
                    STAT.ctime = STAT.mtime;
                    if (isNaN(STAT.size)) {
                        STAT.size = 0;
                    }
                    return STAT;
                }
                catch (e) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
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
    /**
     * @inheritdoc
     */
    writeFile(uri, content, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                this.throwIfWriteFileIsNotAllowed(yield this.tryGetStat(uri), options, uri);
                yield conn.client.filesUpload({
                    autorename: false,
                    contents: vscrw.asBuffer(content),
                    mode: {
                        '.tag': 'overwrite'
                    },
                    mute: false,
                    path: toDropboxPath(uri.path),
                });
            }));
        });
    }
}
/**
 * Stores the name of the scheme.
 */
DropboxFileSystem.scheme = 'dropbox';
exports.DropboxFileSystem = DropboxFileSystem;
function toDropboxPath(p) {
    p = vscrw.normalizePath(p);
    if ('/' === p) {
        p = '';
    }
    return p;
}
//# sourceMappingURL=dropbox.js.map