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
const jsFTP = require('jsftp');
const ParseListening = require("parse-listing");
const Path = require("path");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
/**
 * FTP file system.
 */
class FTPFileSystem extends vscrw_fs.FileSystemBase {
    /**
     * Initializes a new instance of that class.
     */
    constructor() {
        super();
        this._CONN_CACHE = {};
        this._EXECUTE_REMOTE_COMMAND_LISTENER = (execArgs) => {
            execArgs.increaseExecutionCounter();
            (() => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (FTPFileSystem.scheme === vscode_helpers.normalizeString(execArgs.uri.scheme)) {
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
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                    const MKDIR = (dir) => {
                        dir = vscrw.normalizePath(dir);
                        const U = uriWithNewPath(uri, dir);
                        return new Promise((res, rej) => __awaiter(this, void 0, void 0, function* () {
                            const COMP = vscode_helpers.createCompletedAction(res, rej);
                            try {
                                if ('/' !== dir) {
                                    const STAT = yield this.tryGetStat(U, conn);
                                    if (false === STAT) {
                                        conn.client.raw('mkd', [dir], (err) => {
                                            if (err) {
                                                COMP(err);
                                            }
                                            else {
                                                COMP(null, true);
                                            }
                                        });
                                    }
                                    else {
                                        if (vscode.FileType.Directory !== STAT.type) {
                                            throw vscode.FileSystemError.FileNotADirectory(U);
                                        }
                                        else {
                                            COMP(null, false); // already exists
                                        }
                                    }
                                }
                                else {
                                    COMP(null, false); // not the root
                                }
                            }
                            catch (e) {
                                COMP(e);
                            }
                        }));
                    };
                    try {
                        const PARTS = vscrw.normalizePath(uri.path).split('/');
                        for (let i = 0; i < PARTS.length; i++) {
                            yield MKDIR(vscode_helpers.from(PARTS)
                                .take(i + 1)
                                .toArray()
                                .join('/'));
                        }
                        COMPLETED(null);
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                }));
            });
        });
    }
    dele(uri, existingConn) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => {
                return new Promise((res, rej) => __awaiter(this, void 0, void 0, function* () {
                    const COMP = vscode_helpers.createCompletedAction(res, rej);
                    try {
                        const STAT = yield this.statInner(uri, conn);
                        if (vscode.FileType.Directory === STAT.type) {
                            throw vscode.FileSystemError.FileIsADirectory(uri);
                        }
                        conn.client.raw('dele', vscrw.normalizePath(uri.path), (err) => {
                            COMP(err);
                        });
                    }
                    catch (e) {
                        COMP(e);
                    }
                }));
            }, existingConn);
        });
    }
    /**
     * @inheritdoc
     */
    delete(uri, options) {
        return this.forConnection(uri, (conn) => {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                try {
                    const STAT = yield this.statInner(uri, conn);
                    const DELE = (file) => __awaiter(this, void 0, void 0, function* () {
                        file = vscrw.normalizePath(file);
                        const U = uriWithNewPath(uri, file);
                        return yield this.dele(U, conn);
                    });
                    const RMD = (dir) => {
                        dir = vscrw.normalizePath(dir);
                        const U = uriWithNewPath(uri, dir);
                        return new Promise((res, rej) => __awaiter(this, void 0, void 0, function* () {
                            const COMP = vscode_helpers.createCompletedAction(res, rej);
                            try {
                                const STAT = yield this.statInner(U, conn);
                                if (vscode.FileType.Directory !== STAT.type) {
                                    throw vscode.FileSystemError.FileNotADirectory(U);
                                }
                                conn.client.raw('rmd', dir, (err) => {
                                    COMP(err);
                                });
                            }
                            catch (e) {
                                COMP(e);
                            }
                        }));
                    };
                    if (vscode.FileType.Directory === STAT.type) {
                        const REMOVE_FOLDER = (dir) => __awaiter(this, void 0, void 0, function* () {
                            dir = vscrw.normalizePath(dir);
                            const U = uriWithNewPath(uri, dir);
                            const LIST = [];
                            for (const ITEM of yield this.list(U, conn)) {
                                LIST.push({
                                    name: ITEM.name,
                                    stat: yield toFileStat(ITEM, U, conn),
                                });
                            }
                            const SUB_DIRS = vscode_helpers.from(LIST)
                                .where(x => vscode.FileType.Directory === x.stat.type)
                                .orderByDescending(x => x.stat.size)
                                .thenBy(x => vscode_helpers.normalizeString(x))
                                .toArray();
                            const FILES = vscode_helpers.from(LIST)
                                .where(x => vscode.FileType.Directory !== x.stat.type)
                                .orderByDescending(x => x.stat.size)
                                .thenBy(x => vscode_helpers.normalizeString(x))
                                .toArray();
                            // first the sub folders
                            if (options.recursive) {
                                for (const ITEM of SUB_DIRS) {
                                    yield REMOVE_FOLDER(dir + '/' + ITEM.name);
                                }
                            }
                            else {
                                if (SUB_DIRS.length > 0) {
                                    throw vscode.FileSystemError.NoPermissions(uri);
                                }
                            }
                            // then the files
                            for (const ITEM of FILES) {
                                yield DELE(dir + '/' + ITEM.name);
                            }
                            // now the directory itself
                            yield RMD(dir);
                        });
                        yield REMOVE_FOLDER(uri.path);
                    }
                    else {
                        yield DELE(uri.path);
                    }
                    COMPLETED(null);
                }
                catch (e) {
                    COMPLETED(e);
                }
            }));
        });
    }
    executeRemoteCommand(execArgs) {
        return __awaiter(this, void 0, void 0, function* () {
            const CONN = yield this.openConnection(execArgs.uri, true);
            try {
                yield executeServerCommand(CONN.client, 'CWD ' + vscrw.normalizePath(execArgs.uri.path));
                return yield executeServerCommand(CONN.client, execArgs.command);
            }
            finally {
                tryCloseConnection(CONN);
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
                    .trace(e, 'fs.ftp.FTPFileSystem.forConnection()');
                throw e;
            }
        });
    }
    list(uri, existingConn) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => {
                return listDirectory(conn.client, uri.path);
            }, existingConn);
        });
    }
    /**
     * @inheritdoc
     */
    onDispose() {
        for (const CACHE_KEY of Object.keys(this._CONN_CACHE)) {
            try {
                tryCloseConnection(this._CONN_CACHE[CACHE_KEY]);
            }
            catch (_a) { }
            finally {
                delete this._CONN_CACHE[CACHE_KEY];
            }
        }
        vscode_helpers.tryRemoveListener(vscode_helpers.EVENTS, vscrw.EVENT_EXECUTE_REMOTE_COMMAND, this._EXECUTE_REMOTE_COMMAND_LISTENER);
    }
    openConnection(uri, noCache) {
        return __awaiter(this, void 0, void 0, function* () {
            // format:
            //
            // ftp://[user:password@]host:port[/path/to/file/or/folder]
            noCache = vscode_helpers.toBooleanSafe(noCache);
            const CACHE_KEY = vscrw.getConnectionCacheKey(uri);
            const PARAMS = vscrw.getUriParams(uri);
            let conn = false;
            if (!noCache) {
                conn = yield this.testConnection(CACHE_KEY);
            }
            if (false === conn) {
                const HOST_AND_CRED = yield vscrw.extractHostAndCredentials(uri, 21);
                let keepAlive = parseFloat(vscode_helpers.toStringSafe(PARAMS['keepalive']).trim());
                let noop = vscode_helpers.toStringSafe(PARAMS['noop']);
                if (vscode_helpers.isEmptyString(noop)) {
                    noop = undefined;
                }
                if (!noCache) {
                    tryCloseConnection(this._CONN_CACHE[CACHE_KEY]);
                }
                let queueSize = parseInt(vscode_helpers.toStringSafe(PARAMS['queuesize'])
                    .trim());
                if (isNaN(queueSize)) {
                    queueSize = 1;
                }
                conn = {
                    cache: {
                        stats: {},
                    },
                    client: new jsFTP({
                        host: HOST_AND_CRED.host,
                        port: HOST_AND_CRED.port,
                        user: HOST_AND_CRED.user,
                        pass: HOST_AND_CRED.password,
                    }),
                    followSymLinks: vscrw.isTrue(PARAMS['follow'], true),
                    noop: noop,
                    noQueue: !vscrw.isTrue(PARAMS['queue'], true),
                    queue: vscode_helpers.createQueue({
                        concurrency: queueSize,
                    }),
                };
                if (!noCache) {
                    this._CONN_CACHE[CACHE_KEY] = conn;
                }
                if (!isNaN(keepAlive)) {
                    conn.client.keepAlive(Math.floor(keepAlive * 1000.0));
                }
            }
            return conn;
        });
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
                let completedInvoked = false;
                let resultBuffer;
                let socket;
                const COMPLETED = (err) => {
                    if (completedInvoked) {
                        return;
                    }
                    completedInvoked = true;
                    vscode_helpers.tryRemoveAllListeners(socket);
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(resultBuffer);
                    }
                };
                try {
                    socket = yield openRead(conn.client, uri.path);
                    resultBuffer = Buffer.alloc(0);
                    socket.on("data", function (data) {
                        try {
                            if (data) {
                                resultBuffer = Buffer.concat([resultBuffer, data]);
                            }
                        }
                        catch (e) {
                            COMPLETED(e);
                        }
                    });
                    socket.once("close", function (hadErr) {
                        if (hadErr) {
                            COMPLETED(new Error('Could not close socket!'));
                        }
                        else {
                            COMPLETED(null);
                        }
                    });
                    socket.resume();
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
     * @return {FTPFileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new FTPFileSystem();
        try {
            context.subscriptions.push(NEW_FS, vscode.workspace.registerFileSystemProvider(FTPFileSystem.scheme, NEW_FS, { isCaseSensitive: true }));
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
            yield this.forConnection(oldUri, (conn) => {
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
            return new Promise((resolve, reject) => {
                const CONN = this._CONN_CACHE[cacheKey];
                let completedInvoked = false;
                const COMPLETED = (result) => {
                    if (completedInvoked) {
                        return;
                    }
                    completedInvoked = true;
                    if (false === result) {
                        delete this._CONN_CACHE[cacheKey];
                        tryCloseConnection(CONN);
                    }
                    resolve(result);
                };
                let action = () => {
                    COMPLETED(false);
                };
                if (!_.isNil(CONN)) {
                    action = () => {
                        try {
                            let cmd;
                            let cmdArgs;
                            if (_.isNil(CONN.noop)) {
                                cmd = 'NOOP';
                                cmdArgs = [];
                            }
                            else {
                                const PARTS = vscode_helpers.from(CONN.noop.split(' '))
                                    .skipWhile(x => '' === x.trim())
                                    .toArray();
                                cmd = PARTS[0];
                                cmdArgs = vscode_helpers.from(PARTS)
                                    .skip(1)
                                    .skipWhile(x => '' === x.trim())
                                    .toArray();
                            }
                            CONN.client.raw(cmd, cmdArgs, (err) => {
                                COMPLETED(err ? false : CONN);
                            });
                        }
                        catch (_a) {
                            COMPLETED(false);
                        }
                    };
                }
                try {
                    action();
                }
                catch (_a) {
                    COMPLETED(false);
                }
            });
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
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
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
            }));
        });
    }
}
/**
 * Stores the name of the scheme.
 */
FTPFileSystem.scheme = 'ftp';
exports.FTPFileSystem = FTPFileSystem;
function executeServerCommand(conn, cmd) {
    cmd = vscode_helpers.toStringSafe(cmd);
    return new Promise((resolve, reject) => {
        const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
        try {
            const PARTS = cmd.split(' ')
                .filter(x => '' !== x.trim());
            let c;
            if (PARTS.length > 0) {
                c = PARTS[0].trim();
            }
            const ARGS = PARTS.filter((a, i) => i > 0);
            conn.raw(c, ARGS, function (err, result) {
                if (err) {
                    COMPLETED(err);
                }
                else {
                    let response;
                    if (_.isNil(result)) {
                        response = result;
                    }
                    else {
                        response = new Buffer(`[${result.code}] '${vscode_helpers.toStringSafe(result.text)}'`, 'ascii');
                    }
                    COMPLETED(null, response);
                }
            });
        }
        catch (e) {
            COMPLETED(e);
        }
    });
}
function listDirectory(conn, path) {
    return new Promise((resolve, reject) => {
        const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
        try {
            conn.list(vscrw.normalizePath(path), (err, result) => {
                if (err) {
                    if ('451' === vscode_helpers.normalizeString(err.code)) {
                        COMPLETED(null, []);
                        return;
                    }
                    COMPLETED(err);
                    return;
                }
                try {
                    ParseListening.parseEntries(result, (err, list) => {
                        if (err) {
                            COMPLETED(err);
                        }
                        else {
                            COMPLETED(null, vscode_helpers.asArray(list)
                                .filter(x => !vscode_helpers.isEmptyString(x.name)));
                        }
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
    });
}
function openRead(conn, path) {
    return new Promise((resolve, reject) => {
        const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
        try {
            conn.get(vscrw.normalizePath(path), (err, stream) => {
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
                case '0':
                    STAT.type = vscode.FileType.File;
                    break;
                case '1':
                    STAT.type = vscode.FileType.Directory;
                    break;
                case '2':
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
                                    // TODO: implement later
                                    /*
                                    if (false !== type) {
                                        conn.cache.stats[ FILE_OR_FOLDER ] = STAT.type = type;
                                    }
                                    */
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
                STAT.ctime = parseInt(vscode_helpers.toStringSafe(item.time).trim());
                STAT.mtime = parseInt(vscode_helpers.toStringSafe(item.time).trim());
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
        return vscode.Uri.parse(`ftp://${uri.authority}${vscode_helpers.toStringSafe(newPath)}${vscode_helpers.isEmptyString(uri.query) ? '' : ('?' + uri.query)}`);
    }
}
//# sourceMappingURL=ftp.js.map