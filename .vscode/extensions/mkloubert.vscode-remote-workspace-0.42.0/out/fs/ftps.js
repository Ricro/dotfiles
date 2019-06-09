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
const FS = require("fs");
const FSExtra = require("fs-extra");
const FTP = require('@icetee/ftp');
const FTP_Legacy = require('ftp');
const Moment = require("moment");
const Path = require("path");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
/**
 * Secure FTP file system.
 */
class FTPsFileSystem extends vscrw_fs.FileSystemBase {
    /**
     * Initializes a new instance of that class.
     */
    constructor() {
        super();
        this._EXECUTE_REMOTE_COMMAND_LISTENER = (execArgs) => {
            execArgs.increaseExecutionCounter();
            (() => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (FTPsFileSystem.scheme === vscode_helpers.normalizeString(execArgs.uri.scheme)) {
                        const RESPONSE = yield this.executeRemoteCommand(execArgs);
                        if (execArgs.callback) {
                            execArgs.callback(null, {
                                stdOut: RESPONSE,
                            });
                        }
                    }
                }
                catch (e) {
                    if (execArgs.callback) {
                        execArgs.callback(e);
                    }
                    else {
                        throw e;
                    }
                }
            }))().then(() => {
            }, (err) => {
                vscrw.showError(err);
            });
        };
        vscode_helpers.EVENTS.on(vscrw.EVENT_EXECUTE_REMOTE_COMMAND, this._EXECUTE_REMOTE_COMMAND_LISTENER);
    }
    /**
     * @inheritdoc
     */
    createDirectory(uri) {
        return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    conn.client.mkdir(vscrw.normalizePath(uri.path), true, (err) => {
                        COMPLETED(err);
                    });
                }
                catch (e) {
                    COMPLETED(e);
                }
            });
        }));
    }
    /**
     * @inheritdoc
     */
    delete(uri, options) {
        return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
            const STAT = yield this.statInner(uri);
            return new Promise((resolve, reject) => {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    const PATH = vscrw.normalizePath(uri.path);
                    if (vscode.FileType.Directory === STAT.type) {
                        conn.client.rmdir(PATH, options.recursive, (err) => {
                            COMPLETED(err);
                        });
                    }
                    else {
                        conn.client.delete(PATH, (err) => {
                            COMPLETED(err);
                        });
                    }
                }
                catch (e) {
                    COMPLETED(e);
                }
            });
        }));
    }
    executeRemoteCommand(execArgs) {
        return __awaiter(this, void 0, void 0, function* () {
            const CONN = yield this.openConnection(execArgs.uri, true);
            try {
                const CONN = yield this.openConnection(execArgs.uri, true);
                try {
                    yield executeServerCommand(CONN.client, 'CWD ' + vscrw.normalizePath(execArgs.uri.path));
                    return yield executeServerCommand(CONN.client, execArgs.command);
                }
                finally {
                    yield tryCloseConnection(CONN);
                }
            }
            finally {
                yield tryCloseConnection(CONN);
            }
        });
    }
    forConnection(uri, action, existingConn) {
        return __awaiter(this, void 0, void 0, function* () {
            const DO_IT = (connectionToUse) => __awaiter(this, void 0, void 0, function* () {
                if (action) {
                    return yield Promise.resolve(action(connectionToUse));
                }
            });
            const USE_EXISTING_CONN = !_.isNil(existingConn);
            const CONNECTION_TO_USE = USE_EXISTING_CONN ? existingConn
                : yield this.openConnection(uri);
            try {
                if (CONNECTION_TO_USE.noQueue || USE_EXISTING_CONN) {
                    return yield DO_IT(CONNECTION_TO_USE);
                }
                return yield CONNECTION_TO_USE.queue.add(() => __awaiter(this, void 0, void 0, function* () {
                    return DO_IT(CONNECTION_TO_USE);
                }));
            }
            catch (e) {
                this.logger
                    .trace(e, 'fs.ftps.FTPsFileSystem.forConnection()');
                throw e;
            }
            finally {
                if (!USE_EXISTING_CONN) {
                    tryCloseConnection(CONNECTION_TO_USE);
                }
            }
        });
    }
    list(uri, existingConn) {
        return this.forConnection(uri, (conn) => {
            return listDirectory(conn.client, vscrw.normalizePath(uri.path));
        }, existingConn);
    }
    /**
     * @inheritdoc
     */
    onDispose() {
        vscode_helpers.tryRemoveListener(vscode_helpers.EVENTS, vscrw.EVENT_EXECUTE_REMOTE_COMMAND, this._EXECUTE_REMOTE_COMMAND_LISTENER);
    }
    openConnection(uri, noCache) {
        // format:
        //
        // ftps://[user:password@]host:port[/path/to/file/or/folder]
        noCache = vscode_helpers.toBooleanSafe(noCache);
        const CACHE_KEY = vscrw.getConnectionCacheKey(uri);
        const PARAMS = vscrw.getUriParams(uri);
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
            try {
                let conn = false;
                if (!noCache) {
                    conn = yield this.testConnection(CACHE_KEY);
                }
                if (false === conn) {
                    const FOLLOW = vscrw.isTrue(PARAMS['follow'], true);
                    const HOST_AND_CRED = yield vscrw.extractHostAndCredentials(uri, 21);
                    const IS_SECURE = vscrw.isTrue(PARAMS['secure'], true);
                    const LEGACY = vscrw.isTrue(PARAMS['legacy']);
                    let secureOpts;
                    if (IS_SECURE) {
                        secureOpts = {
                            rejectUnauthorized: vscrw.isTrue(PARAMS['rejectunauthorized'], false),
                        };
                    }
                    const KEEP_ALIVE = parseFloat(vscode_helpers.toStringSafe(PARAMS['keepalive']).trim());
                    let queueSize = parseInt(vscode_helpers.toStringSafe(PARAMS['queuesize'])
                        .trim());
                    if (isNaN(queueSize)) {
                        queueSize = 1;
                    }
                    const CLIENT = LEGACY ? new FTP_Legacy()
                        : new FTP();
                    CLIENT.once('error', function (err) {
                        if (err) {
                            COMPLETED(err);
                        }
                    });
                    CLIENT.once('ready', () => {
                        // if (!noCache) {
                        //     tryCloseConnection( this._CONN_CACHE[ CACHE_KEY ] );
                        // }
                        const NEW_CONN = {
                            cache: {
                                stats: {},
                            },
                            client: CLIENT,
                            followSymLinks: FOLLOW,
                            noQueue: !vscrw.isTrue(PARAMS['queue'], true),
                            queue: vscode_helpers.createQueue({
                                concurrency: queueSize,
                            }),
                        };
                        // if (!noCache) {
                        //     this._CONN_CACHE[ CACHE_KEY ] = NEW_CONN;
                        // }
                        COMPLETED(null, NEW_CONN);
                    });
                    CLIENT.connect({
                        host: HOST_AND_CRED.host, port: HOST_AND_CRED.port,
                        user: HOST_AND_CRED.user, password: HOST_AND_CRED.password,
                        secure: IS_SECURE,
                        secureOptions: secureOpts,
                        keepalive: Math.floor((isNaN(KEEP_ALIVE) ? 10.0
                            : KEEP_ALIVE) * 1000.0),
                    });
                }
                else {
                    COMPLETED(null, conn);
                }
            }
            catch (e) {
                COMPLETED(e);
            }
        }));
    }
    /**
     * @inheritdoc
     */
    readDirectory(uri) {
        return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
            const RESULT = [];
            for (const ITEM of yield this.list(uri, conn)) {
                const STAT = yield toFileStat(ITEM, uri, conn);
                RESULT.push([ITEM.name, STAT.type]);
            }
            return RESULT;
        }));
    }
    /**
     * @inheritdoc
     */
    readFile(uri) {
        return this.forConnection(uri, (conn) => {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    const STREAM = yield openRead(conn.client, uri.path);
                    STREAM.once('error', (err) => {
                        if (err) {
                            COMPLETED(err);
                        }
                    });
                    const TEMP_FILE = yield vscode_helpers.tempFile((tf) => {
                        return tf;
                    }, {
                        keep: true,
                    });
                    const TRY_REMOVE_TEMP_FILE = () => __awaiter(this, void 0, void 0, function* () {
                        try {
                            if (yield vscode_helpers.exists(TEMP_FILE)) {
                                yield FSExtra.unlink(TEMP_FILE);
                            }
                        }
                        catch (e) {
                            this.logger
                                .warn(e, 'fs.ftps.FTPsFileSystem.readFile.TRY_REMOVE_TEMP_FILE()');
                        }
                    });
                    const DOWNLOAD_COMPLETED = () => __awaiter(this, void 0, void 0, function* () {
                        try {
                            return yield FSExtra.readFile(TEMP_FILE);
                        }
                        finally {
                            yield TRY_REMOVE_TEMP_FILE();
                        }
                    });
                    try {
                        STREAM.once('close', function () {
                            DOWNLOAD_COMPLETED().then((data) => {
                                COMPLETED(null, data);
                            }, (err) => {
                                COMPLETED(err);
                            });
                        }).once('error', function (err) {
                            TRY_REMOVE_TEMP_FILE().then(() => {
                                COMPLETED(err);
                            }, (e) => {
                                COMPLETED(err);
                            });
                        });
                        const WRITE_STREAM = FS.createWriteStream(TEMP_FILE);
                        WRITE_STREAM.once('error', (err) => {
                            if (err) {
                                COMPLETED(err);
                            }
                        });
                        STREAM.pipe(WRITE_STREAM);
                        STREAM.resume();
                    }
                    catch (e) {
                        TRY_REMOVE_TEMP_FILE().then(() => {
                            COMPLETED(e);
                        }, (err) => {
                            COMPLETED(e);
                        });
                    }
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
     * @return {FTPsFileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new FTPsFileSystem();
        try {
            context.subscriptions.push(vscode.workspace.registerFileSystemProvider(FTPsFileSystem.scheme, NEW_FS, { isCaseSensitive: true }));
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
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    const OLD_STAT = yield this.statInner(oldUri, conn);
                    const NEW_STAT = yield this.tryGetStat(newUri, conn);
                    if (false !== NEW_STAT) {
                        if (!options.overwrite) {
                            throw vscode.FileSystemError.FileExists(newUri);
                        }
                    }
                    conn.client.rename(vscrw.normalizePath(oldUri.path), vscrw.normalizePath(newUri.path), (err) => {
                        COMPLETED(err);
                    });
                }
                catch (e) {
                    COMPLETED(e);
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
    statInner(uri, existingConn) {
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
                let stat = false;
                try {
                    const URI_PATH = vscrw.normalizePath(uri.path);
                    const NAME = Path.basename(URI_PATH);
                    const DIR = vscrw.normalizePath(Path.dirname(URI_PATH));
                    const PARENT_URI = uriWithNewPath(uri, DIR);
                    const LIST = yield this.list(PARENT_URI, conn);
                    for (const ITEM of LIST) {
                        if (ITEM.name === NAME) {
                            stat = yield toFileStat(ITEM, uriWithNewPath(uri, DIR), conn);
                            break;
                        }
                    }
                }
                catch (_a) { }
                if (false === stat) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
                return stat;
            }), existingConn);
        });
    }
    testConnection(cacheKey) {
        return __awaiter(this, void 0, void 0, function* () {
            return false;
            // TODO: implement later
            /*
            return new Promise<FTPsConnection | false>((resolve, reject) => {
                const CONN: FTPsConnection = this._CONN_CACHE[ cacheKey ];
    
                let completedInvoked = false;
                const COMPLETED = (result: FTPsConnection | false) => {
                    if (completedInvoked) {
                        return;
                    }
                    completedInvoked = true;
    
                    if (false === result) {
                        delete this._CONN_CACHE[ cacheKey ];
    
                        tryCloseConnection( CONN );
                    }
    
                    resolve( result );
                };
    
                let action = () => {
                    COMPLETED(false);
                };
    
                if (!_.isNil(CONN)) {
                    action = () => {
                        try {
                            CONN.client['_send']('NOOP', function(err, text, code) {
                                COMPLETED(err ? false : CONN);
                            });
                        } catch {
                            COMPLETED(false);
                        }
                    };
                }
    
                try {
                    action();
                } catch {
                    COMPLETED(false);
                }
            });*/
        });
    }
    tryGetStat(uri, existingConn) {
        return __awaiter(this, void 0, void 0, function* () {
            let stat;
            try {
                stat = yield this.statInner(uri, existingConn);
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
                    this.throwIfWriteFileIsNotAllowed(yield this.tryGetStat(uri, conn), options, uri);
                    conn.client.put(vscrw.asBuffer(content), vscrw.normalizePath(uri.path), (err) => {
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
FTPsFileSystem.scheme = 'ftps';
exports.FTPsFileSystem = FTPsFileSystem;
function executeServerCommand(conn, cmd) {
    cmd = vscode_helpers.toStringSafe(cmd);
    return new Promise((resolve, reject) => {
        const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
        try {
            conn['_send'](cmd, function (err, responseText, responseCode) {
                if (err) {
                    COMPLETED(err);
                }
                else {
                    COMPLETED(null, new Buffer(`[${responseCode}] '${vscode_helpers.toStringSafe(responseText)}'`, 'ascii'));
                }
            });
        }
        catch (e) {
            COMPLETED(e);
        }
    });
}
function listDirectory(client, path) {
    return new Promise((resolve, reject) => {
        const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
        try {
            client.list(vscrw.normalizePath(path), (err, items) => {
                COMPLETED(err, items);
            });
        }
        catch (e) {
            COMPLETED(e);
        }
    });
}
function openRead(client, path) {
    return new Promise((resolve, reject) => {
        const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
        try {
            client.get(vscrw.normalizePath(path), (err, stream) => {
                COMPLETED(err, stream);
            });
        }
        catch (e) {
            COMPLETED(e);
        }
    });
}
function toFileStat(item, uri, conn) {
    return __awaiter(this, void 0, void 0, function* () {
        if (item) {
            const STAT = {
                ctime: undefined,
                mtime: undefined,
                size: undefined,
                type: vscode.FileType.Unknown,
            };
            switch (vscode_helpers.normalizeString(item.type)) {
                case '-':
                    STAT.type = vscode.FileType.File;
                    break;
                case 'd':
                    STAT.type = vscode.FileType.Directory;
                    break;
                case 'l':
                    {
                        STAT.type = vscode.FileType.SymbolicLink;
                        if (conn.followSymLinks) {
                            try {
                                const FILE_OR_FOLDER = vscrw.normalizePath(Path.join(uri.path, item.name));
                                const CACHED_VALUE = conn.cache.stats[FILE_OR_FOLDER];
                                if (_.isNil(CACHED_VALUE)) {
                                    let type = false;
                                    try {
                                        // first try to check if file ...
                                        const STREAM = yield openRead(conn.client, FILE_OR_FOLDER);
                                        // ... yes
                                        try {
                                            if (_.isFunction(STREAM.destroy)) {
                                                STREAM.destroy();
                                            }
                                        }
                                        catch (_a) { }
                                        type = vscode.FileType.File;
                                    }
                                    catch (_b) {
                                        // now try to check if directory ...
                                        try {
                                            yield listDirectory(conn.client, FILE_OR_FOLDER);
                                            // ... yes
                                            type = vscode.FileType.Directory;
                                        }
                                        catch ( /* no, handle as symbol link */_c) { /* no, handle as symbol link */ }
                                    }
                                    if (false !== type) {
                                        STAT.type = type;
                                    }
                                }
                            }
                            catch (_d) {
                                STAT.type = vscode.FileType.SymbolicLink;
                            }
                        }
                    }
                    break;
            }
            if (vscode.FileType.File === STAT.type) {
                let date;
                if (Moment.isDate(item.date)) {
                    date = vscode_helpers.asUTC(Moment(date)).unix();
                }
                STAT.ctime = date;
                STAT.mtime = date;
                STAT.size = parseInt(vscode_helpers.toStringSafe(item.size).trim());
            }
            if (isNaN(STAT.ctime)) {
                STAT.ctime = 0;
            }
            if (isNaN(STAT.mtime)) {
                STAT.mtime = 0;
            }
            if (isNaN(STAT.size)) {
                STAT.size = 0;
            }
            return STAT;
        }
    });
}
function tryCloseConnection(conn) {
    try {
        if (conn) {
            conn.client.destroy();
        }
        return true;
    }
    catch (_a) {
        return false;
    }
}
function uriWithNewPath(uri, newPath) {
    if (uri) {
        return vscode.Uri.parse(`ftps://${uri.authority}${vscode_helpers.toStringSafe(newPath)}${vscode_helpers.isEmptyString(uri.query) ? '' : ('?' + uri.query)}`);
    }
}
//# sourceMappingURL=ftps.js.map