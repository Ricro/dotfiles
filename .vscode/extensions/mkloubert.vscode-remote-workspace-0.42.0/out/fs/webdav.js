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
const _ = require("lodash");
const Moment = require("moment");
const Path = require("path");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
const WebDAV = require("webdav-client");
const DEFAULT_BINARY_FILE_ENCODING = 'binary';
const DEFAULT_TEXT_FILE_ENCODING = 'binary';
/**
 * WebDAV file system.
 */
class WebDAVFileSystem extends vscrw_fs.FileSystemBase {
    /**
     * @inheritdoc
     */
    copy(source, destination, options) {
        return this.forConnection(source, (conn) => {
            return new Promise((resolve, reject) => {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    conn.client.copy(toWebDAVPath(source.path), toWebDAVPath(destination.path), options.overwrite, (err) => {
                        COMPLETED(err);
                    });
                }
                catch (e) {
                    COMPLETED(e);
                }
            });
        });
    }
    /**
     * @inheritdoc
     */
    createDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => {
                return new Promise((resolve, reject) => {
                    const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                    try {
                        conn.client.mkdir(toWebDAVPath(uri.path), (err) => {
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
    /**
     * @inheritdoc
     */
    delete(uri, options) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => {
                return new Promise((resolve, reject) => {
                    const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                    try {
                        conn.client.delete(toWebDAVPath(uri.path), (err) => {
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
                    .trace(e, 'fs.webdav.WebDAVFileSystem.forConnection()');
                throw e;
            }
        });
    }
    getDetails(uri) {
        return this.forConnection(uri, (conn) => {
            return new Promise((resolve, reject) => {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    conn.client.getProperties(toWebDAVPath(uri.path), (err, properties) => {
                        if (err) {
                            COMPLETED(err);
                            return;
                        }
                        try {
                            const NEW_RESULT = {
                                creationDate: undefined,
                                lastModified: undefined,
                                name: Path.basename(uri.path),
                                size: undefined,
                                type: 'f',
                            };
                            let creationdate;
                            let lastmodified;
                            if (properties) {
                                for (const P in properties) {
                                    try {
                                        const PROP = properties[P];
                                        if (_.isNil(PROP)) {
                                            continue;
                                        }
                                        switch (vscode_helpers.normalizeString(P)) {
                                            case 'dav:creationdate':
                                                if (!vscode_helpers.isEmptyString(PROP.content)) {
                                                    creationdate = Moment(vscode_helpers.toStringSafe(PROP.content).trim());
                                                }
                                                break;
                                            case 'dav:getlastmodified':
                                                if (!vscode_helpers.isEmptyString(PROP.content)) {
                                                    lastmodified = Moment(vscode_helpers.toStringSafe(PROP.content).trim());
                                                }
                                                break;
                                            case 'dav:getcontentlength':
                                                if (!vscode_helpers.isEmptyString(PROP.content)) {
                                                    NEW_RESULT.size = parseInt(vscode_helpers.toStringSafe(PROP.content).trim());
                                                }
                                                break;
                                            case 'dav:resourcetype':
                                                {
                                                    const IS_DIR = vscode_helpers.from(vscode_helpers.asArray(PROP.content)).any(c => {
                                                        return 'dav:collection' ===
                                                            vscode_helpers.normalizeString(c.name);
                                                    });
                                                    if (IS_DIR) {
                                                        NEW_RESULT.type = 'd';
                                                    }
                                                }
                                                break;
                                        }
                                    }
                                    catch (_a) { }
                                }
                            }
                            if (creationdate && creationdate.isValid()) {
                                NEW_RESULT.creationDate = vscode_helpers.asUTC(creationdate).unix();
                            }
                            if (lastmodified && lastmodified.isValid()) {
                                NEW_RESULT.lastModified = vscode_helpers.asUTC(lastmodified).unix();
                            }
                            if (isNaN(NEW_RESULT.creationDate)) {
                                NEW_RESULT.creationDate = 0;
                            }
                            if (isNaN(NEW_RESULT.lastModified)) {
                                NEW_RESULT.lastModified = 0;
                            }
                            if (isNaN(NEW_RESULT.size)) {
                                NEW_RESULT.size = 0;
                            }
                            COMPLETED(null, NEW_RESULT);
                        }
                        catch (e) {
                            COMPLETED(e);
                        }
                    });
                }
                catch (e) {
                    COMPLETED(e);
                }
            });
        });
    }
    getEncoding(data, textEnc, binEnc) {
        let enc;
        try {
            enc = vscode_helpers.isBinaryContentSync(data) ? binEnc : textEnc;
        }
        catch (e) {
            this.logger
                .warn(e, 'fs.WebDAVFileSystem.getEncoding()');
        }
        if (vscode_helpers.isEmptyString(enc)) {
            enc = DEFAULT_TEXT_FILE_ENCODING;
        }
        return enc;
    }
    list(uri) {
        return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
            const WF = vscode_helpers.buildWorkflow();
            return WF.next(() => {
                return new Promise((resolve, reject) => {
                    const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                    try {
                        conn.client.readdir(toWebDAVPath(uri.path), {
                            properties: false,
                        }, (err, files) => {
                            if (err) {
                                COMPLETED(err);
                            }
                            else {
                                COMPLETED(null, vscode_helpers.asArray(files));
                            }
                        });
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                });
            }).next((files) => {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    const ALL_RESULTS = [];
                    const COMPLETED = (err) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve(vscode_helpers.from(ALL_RESULTS).orderBy(r => {
                                return 'd' === r.type ? 0 : 1;
                            }).thenBy(r => {
                                return vscode_helpers.normalizeString(r.name);
                            }).toArray());
                        }
                    };
                    try {
                        const GET_NEXT_PROPERTIES = () => __awaiter(this, void 0, void 0, function* () {
                            if (files.length < 1) {
                                COMPLETED(null);
                                return;
                            }
                            const F = files.shift();
                            try {
                                ALL_RESULTS.push(yield this.getDetails(uriWithNewPath(uri, vscrw.normalizePath(uri.path) + '/' + F)));
                            }
                            catch (_a) { }
                            yield GET_NEXT_PROPERTIES();
                        });
                        yield GET_NEXT_PROPERTIES();
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                }));
            }).start();
        }));
    }
    openConnection(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            // format:
            //
            // webdav://[user:password@]host[:port][/path/to/file/or/folder]
            const PARAMS = vscrw.getUriParams(uri);
            let base = vscrw.normalizePath(vscode_helpers.toStringSafe(PARAMS['base']));
            let ssl = vscrw.isTrue(PARAMS['ssl']);
            let enc = vscode_helpers.normalizeString(PARAMS['encoding']);
            if ('' === enc) {
                enc = DEFAULT_TEXT_FILE_ENCODING;
            }
            let binEnc = vscode_helpers.normalizeString(PARAMS['binencoding']);
            if ('' === binEnc) {
                binEnc = DEFAULT_BINARY_FILE_ENCODING;
            }
            const HOST_AND_CRED = yield vscrw.extractHostAndCredentials(uri, ssl ? 443 : 80);
            let authenticator;
            if (!_.isNil(HOST_AND_CRED.user) || !_.isNil(HOST_AND_CRED.password)) {
                const AUTH_TYPE = vscode_helpers.normalizeString(PARAMS['authtype']);
                switch (AUTH_TYPE) {
                    case '':
                    case 'b':
                    case 'basic':
                        authenticator = new WebDAV.BasicAuthenticator();
                        break;
                    case 'd':
                    case 'digest':
                        authenticator = new WebDAV.DigestAuthenticator();
                        break;
                    default:
                        throw new Error(`Authentication type '${AUTH_TYPE}' is not supported!`);
                }
            }
            const CONN_OPTS = {
                authenticator: authenticator,
                password: HOST_AND_CRED.password,
                username: HOST_AND_CRED.user,
                url: `http${ssl ? 's' : ''}://${HOST_AND_CRED.host}:${HOST_AND_CRED.port}${base}`,
            };
            return {
                client: new WebDAV.Connection(CONN_OPTS),
                binaryEncoding: binEnc,
                encoding: enc,
            };
        });
    }
    /**
     * @inheritdoc
     */
    readDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const ENTRIES = [];
                const LIST = yield this.list(uri);
                for (const ITEM of LIST) {
                    ENTRIES.push([
                        ITEM.name,
                        'd' === ITEM.type ? vscode.FileType.Directory
                            : vscode.FileType.File
                    ]);
                }
                return ENTRIES;
            }
            catch (e) {
                vscode.FileSystemError.FileNotFound(uri);
            }
        });
    }
    /**
     * @inheritdoc
     */
    readFile(uri) {
        return this.forConnection(uri, (conn) => {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    conn.client.get(toWebDAVPath(uri.path), (err, body) => {
                        if (err) {
                            COMPLETED(err);
                        }
                        else {
                            try {
                                const ENC = this.getEncoding(new Buffer(body, DEFAULT_TEXT_FILE_ENCODING), conn.encoding, conn.binaryEncoding);
                                COMPLETED(null, new Buffer(vscode_helpers.toStringSafe(body), ENC));
                            }
                            catch (e) {
                                COMPLETED(e);
                            }
                        }
                    });
                }
                catch (e) {
                    COMPLETED(e);
                }
            }));
        });
    }
    /**
     * Register file system to extension.
     *
     * @param {vscode.ExtensionContext} context The extension context.
     *
     * @return {WebDAVFileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new WebDAVFileSystem();
        try {
            context.subscriptions.push(vscode.workspace.registerFileSystemProvider(WebDAVFileSystem.scheme, NEW_FS, { isCaseSensitive: true }));
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
        return this.forConnection(oldUri, (conn) => {
            return new Promise((resolve, reject) => {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    conn.client.move(toWebDAVPath(oldUri.path), toWebDAVPath(newUri.path), options.overwrite, (err) => {
                        COMPLETED(err);
                    });
                }
                catch (e) {
                    COMPLETED(e);
                }
            });
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
            const DETAILS = yield this.getDetails(uri);
            return {
                ctime: DETAILS.creationDate,
                mtime: DETAILS.lastModified,
                size: DETAILS.size,
                type: 'd' === DETAILS.type ? vscode.FileType.Directory
                    : vscode.FileType.File,
            };
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
        return this.forConnection(uri, (conn) => {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    this.throwIfWriteFileIsNotAllowed(yield this.tryGetStat(uri), options, uri);
                    const DATA_TO_WRITE = vscrw.asBuffer(content);
                    const ENC = this.getEncoding(DATA_TO_WRITE, conn.encoding, conn.binaryEncoding);
                    conn.client.put(toWebDAVPath(uri.path), DATA_TO_WRITE.toString(ENC), (err) => {
                        COMPLETED(err);
                    });
                }
                catch (e) {
                    COMPLETED(e);
                }
            }));
        });
    }
}
/**
 * Stores the name of the scheme.
 */
WebDAVFileSystem.scheme = 'webdav';
exports.WebDAVFileSystem = WebDAVFileSystem;
function toWebDAVPath(p) {
    return encodeURI(vscrw.normalizePath(p));
}
function uriWithNewPath(uri, newPath) {
    if (uri) {
        return vscode.Uri.parse(`webdav://${uri.authority}${vscrw.normalizePath(newPath)}${vscode_helpers.isEmptyString(uri.query) ? '' : ('?' + uri.query)}`);
    }
}
//# sourceMappingURL=webdav.js.map