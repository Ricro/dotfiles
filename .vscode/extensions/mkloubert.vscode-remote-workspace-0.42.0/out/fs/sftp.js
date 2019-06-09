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
const FSExtra = require("fs-extra");
const OS = require("os");
const Path = require("path");
const SFTP = require('ssh2-sftp-client');
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
/**
 * SFTP file system.
 */
class SFTPFileSystem extends vscrw_fs.FileSystemBase {
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
                    if (SFTPFileSystem.scheme === vscode_helpers.normalizeString(execArgs.uri.scheme)) {
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
            yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const STAT = yield this.tryGetStat(uri, conn);
                if (false !== STAT) {
                    if (vscode.FileType.Directory === STAT.type) {
                        this.throwWithoutAuthority(uri, u => vscode.FileSystemError.FileExists(u));
                    }
                    else {
                        this.throwWithoutAuthority(uri, u => vscode.FileSystemError.NoPermissions(u));
                    }
                }
                yield conn.client.mkdir(vscrw.normalizePath(uri.path), true);
                yield conn.changeMode(vscode.FileType.Directory, uri);
            }));
        });
    }
    /**
     * @inheritdoc
     */
    delete(uri, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const STAT = yield this.statInner(uri, conn);
                if (vscode.FileType.Directory === STAT.type) {
                    yield conn.client.rmdir(vscrw.normalizePath(uri.path), options.recursive);
                }
                else {
                    yield conn.client.delete(vscrw.normalizePath(uri.path));
                }
            }));
        });
    }
    executeRemoteCommand(execArgs) {
        return __awaiter(this, void 0, void 0, function* () {
            const CONN = yield this.openConnection(execArgs.uri, true);
            try {
                return yield this.forConnection(execArgs.uri, (conn) => {
                    return execServerCommand(conn.client, `cd "${execArgs.uri.path}" && ${execArgs.command}`);
                }, CONN);
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
                    .trace(e, 'fs.sftp.SFTPFileSystem.forConnection()');
                throw e;
            }
        });
    }
    /**
     * @inheritdoc
     */
    onDispose() {
        for (const CACHE_KEY of Object.keys(this._CONN_CACHE)) {
            this.tryCloseAndDeleteConnectionSync(CACHE_KEY);
        }
        vscode_helpers.tryRemoveListener(vscode_helpers.EVENTS, vscrw.EVENT_EXECUTE_REMOTE_COMMAND, this._EXECUTE_REMOTE_COMMAND_LISTENER);
    }
    openConnection(uri, noCache) {
        return __awaiter(this, void 0, void 0, function* () {
            // format:
            //
            // sftp://[user:password@]host:port[/path/to/file/or/folder]
            noCache = vscode_helpers.toBooleanSafe(noCache);
            const CACHE_KEY = vscrw.getConnectionCacheKey(uri);
            const PARAMS = vscrw.getUriParams(uri);
            let conn = false;
            if (!noCache) {
                conn = yield this.testConnection(CACHE_KEY);
            }
            if (false === conn) {
                const HOST_AND_CRED = yield vscrw.extractHostAndCredentials(uri, 22);
                const MODE = vscode_helpers.toStringSafe(PARAMS['mode']);
                let dirMode = vscode_helpers.toStringSafe(PARAMS['dirmode']);
                if (vscode_helpers.isEmptyString(dirMode)) {
                    dirMode = MODE;
                }
                let fileModeValueOrPath = false;
                if (!vscode_helpers.isEmptyString(MODE)) {
                    fileModeValueOrPath = parseInt(MODE.trim());
                    if (isNaN(fileModeValueOrPath)) {
                        fileModeValueOrPath = MODE;
                    }
                }
                let dirModeValueOrPath = false;
                if (!vscode_helpers.isEmptyString(dirMode)) {
                    dirModeValueOrPath = parseInt(dirMode.trim());
                    if (isNaN(dirModeValueOrPath)) {
                        dirModeValueOrPath = dirMode;
                    }
                }
                let noop = vscode_helpers.toStringSafe(PARAMS['noop']);
                if (vscode_helpers.isEmptyString(noop)) {
                    noop = undefined;
                }
                let queueSize = parseInt(vscode_helpers.toStringSafe(PARAMS['queuesize'])
                    .trim());
                if (isNaN(queueSize)) {
                    queueSize = 1;
                }
                conn = {
                    cache: {
                        stats: {}
                    },
                    changeMode: (ft, u, m) => {
                        const LOG_TAG = `fs.sftp.openConnection.changeMode(${u})`;
                        m = parseInt(vscode_helpers.toStringSafe(m).trim());
                        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                            let completedInvoked = false;
                            const COMPLETED = (err) => {
                                if (completedInvoked) {
                                    return;
                                }
                                completedInvoked = true;
                                if (err) {
                                    this.logger
                                        .trace(err, LOG_TAG);
                                    resolve(false);
                                }
                                else {
                                    resolve(true);
                                }
                            };
                            try {
                                const SFTP_CONN = conn;
                                let action = () => {
                                    COMPLETED(null);
                                };
                                let modeValueOrPathToUse = false;
                                if (isNaN(m)) {
                                    if (vscode.FileType.Directory === ft) {
                                        modeValueOrPathToUse = dirModeValueOrPath;
                                    }
                                    else {
                                        modeValueOrPathToUse = fileModeValueOrPath;
                                    }
                                }
                                else {
                                    // use explicit value
                                    modeValueOrPathToUse = m;
                                }
                                if (false !== modeValueOrPathToUse) {
                                    let mapper;
                                    if (_.isNumber(modeValueOrPathToUse)) {
                                        mapper = {};
                                        mapper[modeValueOrPathToUse] = '**/*';
                                    }
                                    else if (_.isString(modeValueOrPathToUse)) {
                                        const MODE_FILE = vscrw.mapToUsersHome(modeValueOrPathToUse);
                                        if (yield vscode_helpers.isFile(MODE_FILE)) {
                                            mapper = JSON.parse(yield FSExtra.readFile(MODE_FILE, 'utf8'));
                                        }
                                        else {
                                            this.logger
                                                .warn(`Mode file '${modeValueOrPathToUse}' not found!`, LOG_TAG);
                                        }
                                    }
                                    if (mapper) {
                                        const FILE_OR_FOLDER = vscrw.normalizePath(u.path);
                                        let modeToSet = false;
                                        for (const M in mapper) {
                                            const MODE_VALUE = parseInt(vscode_helpers.toStringSafe(M).trim(), 8);
                                            if (isNaN(MODE_VALUE)) {
                                                this.logger
                                                    .warn(`'${M}' is not valid mode value!`, LOG_TAG);
                                                continue;
                                            }
                                            const PATTERNS = vscode_helpers.asArray(mapper[M]).map(x => {
                                                return vscode_helpers.toStringSafe(x);
                                            }).filter(x => !vscode_helpers.isEmptyString(x)).map(x => {
                                                if (!x.trim().startsWith('/')) {
                                                    x = '/' + x;
                                                }
                                                return x;
                                            });
                                            if (vscode_helpers.doesMatch(FILE_OR_FOLDER, PATTERNS)) {
                                                modeToSet = MODE_VALUE; // last wins
                                            }
                                        }
                                        if (false !== modeToSet) {
                                            this.logger
                                                .info(`Setting mode of '${FILE_OR_FOLDER}' to ${modeToSet.toString(8)}`, LOG_TAG);
                                            action = () => {
                                                SFTP_CONN.client['sftp'].chmod(FILE_OR_FOLDER, modeToSet, (err) => {
                                                    COMPLETED(err);
                                                });
                                            };
                                        }
                                    }
                                }
                                action();
                            }
                            catch (e) {
                                COMPLETED(e);
                            }
                        }));
                    },
                    client: new SFTP(),
                    followSymLinks: vscrw.isTrue(PARAMS['follow'], true),
                    keepMode: vscrw.isTrue(PARAMS['keepmode'], true),
                    noop: noop,
                    noQueue: !vscrw.isTrue(PARAMS['queue'], true),
                    queue: vscode_helpers.createQueue({
                        concurrency: queueSize,
                    }),
                };
                let agent = vscode_helpers.toStringSafe(PARAMS['agent']);
                let agentForward = vscode_helpers.normalizeString(PARAMS['agentforward']);
                let debug = vscrw.isTrue(PARAMS['debug']);
                let hashes = vscode_helpers.normalizeString(PARAMS['allowedhashes']).split(',').map(h => {
                    return h.trim();
                }).filter(h => {
                    return '' !== h;
                });
                let hostHash = vscode_helpers.normalizeString(PARAMS['hash']);
                let keepAlive = parseFloat(vscode_helpers.toStringSafe(PARAMS['keepalive']).trim());
                const NO_PHRASE_FILE = vscrw.isTrue(PARAMS['nophrasefile']);
                let passphrase = vscode_helpers.toStringSafe(PARAMS['phrase']);
                let readyTimeout = parseInt(vscode_helpers.normalizeString(PARAMS['timeout']));
                let tryKeyboard = vscode_helpers.normalizeString(PARAMS['trykeyboard']);
                if ('' === passphrase) {
                    passphrase = undefined;
                }
                // external passphrase file?
                try {
                    if (!vscode_helpers.isEmptyString(passphrase)) {
                        if (!NO_PHRASE_FILE) {
                            const PHRASE_FILE = yield vscrw.mapToUsersHome(passphrase);
                            if (yield vscode_helpers.isFile(PHRASE_FILE)) {
                                // read from file
                                passphrase = yield FSExtra.readFile(PHRASE_FILE, 'utf8');
                            }
                        }
                    }
                }
                catch (_a) { }
                let privateKey;
                let key = vscode_helpers.toStringSafe(PARAMS['key']);
                if (!vscode_helpers.isEmptyString(key)) {
                    try {
                        let keyFile = key;
                        if (!Path.isAbsolute(keyFile)) {
                            keyFile = Path.join(OS.homedir(), '.ssh', keyFile);
                        }
                        keyFile = Path.resolve(keyFile);
                        if (yield vscode_helpers.isFile(keyFile)) {
                            privateKey = yield FSExtra.readFile(keyFile);
                        }
                    }
                    catch (_b) { }
                    if (!privateKey) {
                        privateKey = new Buffer(key, 'base64');
                    }
                }
                const OPTS = {
                    agent: vscode_helpers.isEmptyString(agent)
                        ? (process.platform === 'win32' ? 'pageant' : process.env.SSH_AUTH_SOCK)
                        : agent,
                    agentForward: vscrw.isTrue(agentForward),
                    host: HOST_AND_CRED.host,
                    hostHash: ('' === hostHash ? 'md5' : hostHash),
                    hostVerifier: (keyHash) => {
                        if (hashes.length < 1) {
                            return true;
                        }
                        return hashes.indexOf(vscode_helpers.normalizeString(keyHash)) > -1;
                    },
                    keepaliveInterval: isNaN(keepAlive) ? undefined
                        : Math.floor(keepAlive * 1000.0),
                    passphrase: '' === passphrase ? undefined
                        : passphrase,
                    password: HOST_AND_CRED.password,
                    privateKey: privateKey,
                    port: HOST_AND_CRED.port,
                    readyTimeout: isNaN(readyTimeout) ? 20000
                        : readyTimeout,
                    tryKeyboard: '' === tryKeyboard ? undefined
                        : vscrw.isTrue(tryKeyboard),
                    username: HOST_AND_CRED.user,
                };
                if (debug) {
                    OPTS.debug = (information) => {
                        try {
                            this.logger
                                .info(information, `sftp://${HOST_AND_CRED.host}:${HOST_AND_CRED.port}`);
                        }
                        catch (_a) { }
                    };
                }
                if (!noCache) {
                    yield this.tryCloseAndDeleteConnection(CACHE_KEY);
                }
                if (tryKeyboard) {
                    const PWD = vscode_helpers.toStringSafe(HOST_AND_CRED.password);
                    conn.client['client'].on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
                        try {
                            finish([PWD]);
                        }
                        catch (e) {
                            this.logger
                                .trace(e, 'fs.sftp.SFTPFileSystem.openConnection(keyboard-interactive)');
                        }
                    });
                }
                yield conn.client.connect(OPTS);
                if (!noCache) {
                    this._CONN_CACHE[CACHE_KEY] = conn;
                }
            }
            return conn;
        });
    }
    /**
     * @inheritdoc
     */
    readDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const ITEMS = [];
                try {
                    const LIST = yield conn.client.list(vscrw.normalizePath(uri.path));
                    for (const ITEM of LIST) {
                        const S = yield toFileStat(ITEM, uri, conn);
                        ITEMS.push([
                            S[0], S[1].type
                        ]);
                    }
                }
                catch (_a) {
                    this.throwWithoutAuthority(uri, u => vscode.FileSystemError.FileNotFound(u));
                }
                return vscode_helpers.from(ITEMS).orderBy(i => {
                    return i[1] === vscode.FileType.Directory ? 0 : 1;
                }).thenBy(i => {
                    return vscode_helpers.normalizeString(i[0]);
                }).toArray();
            }));
        });
    }
    /**
     * @inheritdoc
     */
    readFile(uri) {
        return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
            return vscrw.asBuffer(yield conn.client.get(vscrw.normalizePath(uri.path)));
        }));
    }
    /**
     * Register file system to extension.
     *
     * @param {vscode.ExtensionContext} context The extension context.
     *
     * @return {SFTPFileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new SFTPFileSystem();
        try {
            context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SFTPFileSystem.scheme, NEW_FS, { isCaseSensitive: true }));
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
                const OLD_STAT = yield this.statInner(oldUri, conn);
                const NEW_STAT = yield this.tryGetStat(newUri, conn);
                if (false !== NEW_STAT) {
                    if (!options.overwrite) {
                        this.throwWithoutAuthority(newUri, u => vscode.FileSystemError.FileExists(u));
                    }
                }
                yield conn.client.rename(vscrw.normalizePath(oldUri.path), vscrw.normalizePath(newUri.path));
                yield conn.changeMode(OLD_STAT.type, newUri);
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
                    '__vscrw_fileinfo': undefined,
                    type: vscode.FileType.Directory,
                    ctime: 0,
                    mtime: 0,
                    size: 0,
                };
            }
            return yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                let stat = false;
                try {
                    const URI_PATH = vscrw.normalizePath(uri.path);
                    const NAME = Path.basename(URI_PATH);
                    const DIR = vscrw.normalizePath(Path.dirname(URI_PATH));
                    const LIST = yield conn.client.list(DIR);
                    for (const ITEM of LIST) {
                        if (ITEM.name === NAME) {
                            const S = yield toFileStat(ITEM, uriWithNewPath(uri, DIR), conn);
                            stat = S[1];
                            break;
                        }
                    }
                }
                catch (_a) { }
                if (false === stat) {
                    this.throwWithoutAuthority(uri, u => vscode.FileSystemError.FileNotFound(u));
                }
                return stat;
            }), existingConn);
        });
    }
    testConnection(cacheKey) {
        return __awaiter(this, void 0, void 0, function* () {
            let result = false;
            const CONN = this._CONN_CACHE[cacheKey];
            if (!_.isNil(CONN)) {
                try {
                    if (_.isNil(CONN.noop)) {
                        yield CONN.client.list('/');
                    }
                    else {
                        yield execServerCommand(CONN.client, CONN.noop);
                    }
                    result = CONN;
                }
                catch (_a) {
                    result = false;
                }
            }
            if (false === result) {
                yield this.tryCloseAndDeleteConnection(cacheKey);
            }
            return result;
        });
    }
    tryCloseAndDeleteConnection(cacheKey) {
        return __awaiter(this, void 0, void 0, function* () {
            yield tryCloseConnection(this._CONN_CACHE[cacheKey]);
            delete this._CONN_CACHE[cacheKey];
        });
    }
    tryCloseAndDeleteConnectionSync(cacheKey) {
        this.tryCloseAndDeleteConnection(cacheKey).then(() => {
        }, (err) => {
        });
    }
    tryGetMod(uri, stat, existingConn) {
        return __awaiter(this, arguments, void 0, function* () {
            if (arguments.length < 2) {
                stat = yield this.tryGetStat(uri, existingConn);
            }
            let mod;
            if (false !== stat) {
                if (stat.__vscrw_fileinfo) {
                    mod = chmodRightsToNumber(stat.__vscrw_fileinfo.rights);
                }
            }
            return mod;
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
                const STAT = yield this.tryGetStat(uri, conn);
                this.throwIfWriteFileIsNotAllowed(STAT, options, uri);
                let oldMod;
                if (conn.keepMode) {
                    oldMod = yield this.tryGetMod(uri, STAT, conn);
                }
                yield conn.client.put(vscrw.asBuffer(content), vscrw.normalizePath(uri.path));
                yield conn.changeMode(vscode.FileType.File, uri, oldMod);
            }));
        });
    }
}
/**
 * Stores the name of the scheme.
 */
SFTPFileSystem.scheme = 'sftp';
exports.SFTPFileSystem = SFTPFileSystem;
function chmodRightsToNumber(rights) {
    if (_.isNil(rights)) {
        return rights;
    }
    const USER = vscode_helpers.normalizeString(rights.user);
    const GROUP = vscode_helpers.normalizeString(rights.group);
    const OTHER = vscode_helpers.normalizeString(rights.other);
    let u = 0;
    for (let i = 0; i < USER.length; i++) {
        switch (USER[i]) {
            case 'r':
                u = u | 4;
                break;
            case 'w':
                u = u | 2;
                break;
            case 'x':
                u = u | 1;
                break;
        }
    }
    let g = 0;
    for (let i = 0; i < GROUP.length; i++) {
        switch (GROUP[i]) {
            case 'r':
                g = g | 4;
                break;
            case 'w':
                g = g | 2;
                break;
            case 'x':
                g = g | 1;
                break;
        }
    }
    let o = 0;
    for (let i = 0; i < OTHER.length; i++) {
        switch (OTHER[i]) {
            case 'r':
                o = o | 4;
                break;
            case 'w':
                o = o | 2;
                break;
            case 'x':
                o = o | 1;
                break;
        }
    }
    return parseInt(`${u}${g}${o}`);
}
function execServerCommand(conn, cmd) {
    cmd = vscode_helpers.toStringSafe(cmd);
    return new Promise((resolve, reject) => {
        let output;
        let completedInvoked = false;
        const COMPLETED = (err) => {
            if (completedInvoked) {
                return;
            }
            completedInvoked = true;
            if (err) {
                reject(err);
            }
            else {
                resolve(output);
            }
        };
        try {
            output = Buffer.alloc(0);
            conn['client'].exec(cmd, (err, stream) => {
                if (err) {
                    COMPLETED(err);
                    return;
                }
                try {
                    let dataListener;
                    let endListener;
                    let errorListener;
                    const CLOSE_STREAM = (err) => {
                        vscode_helpers.tryRemoveListener(stream, 'end', endListener);
                        vscode_helpers.tryRemoveListener(stream, 'error', errorListener);
                        vscode_helpers.tryRemoveListener(stream, 'data', dataListener);
                        COMPLETED(err);
                    };
                    errorListener = (streamErr) => {
                        CLOSE_STREAM(streamErr);
                    };
                    endListener = () => {
                        CLOSE_STREAM(null);
                    };
                    dataListener = (chunk) => {
                        if (_.isNil(chunk)) {
                            return;
                        }
                        try {
                            if (!Buffer.isBuffer(chunk)) {
                                chunk = new Buffer(vscode_helpers.toStringSafe(chunk), 'binary');
                            }
                            output = Buffer.concat([output, chunk]);
                        }
                        catch (e) {
                            CLOSE_STREAM(e);
                        }
                    };
                    try {
                        stream.once('error', errorListener);
                        stream.once('end', endListener);
                        stream.on('data', dataListener);
                    }
                    catch (e) {
                        CLOSE_STREAM(e);
                    }
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
function toFileStat(fi, uri, conn) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fi) {
            const STAT = {
                '__vscrw_fileinfo': fi,
                type: vscode.FileType.Unknown,
                ctime: 0,
                mtime: 0,
                size: 0,
            };
            if ('d' === fi.type) {
                STAT.type = vscode.FileType.Directory;
            }
            else if ('l' === fi.type) {
                STAT.type = vscode.FileType.SymbolicLink;
                if (conn.followSymLinks) {
                    try {
                        const FILE_OR_FOLDER = vscrw.normalizePath(Path.join(uri.path, fi.name));
                        const CACHED_VALUE = conn.cache.stats[FILE_OR_FOLDER];
                        if (_.isNil(CACHED_VALUE)) {
                            let type = false;
                            try {
                                // first try to check if file ...
                                const STREAM = yield conn.client.get(FILE_OR_FOLDER);
                                // ... yes
                                try {
                                    if (_.isFunction(STREAM.close)) {
                                        STREAM.close();
                                    }
                                }
                                catch (_a) { }
                                type = vscode.FileType.File;
                            }
                            catch (_b) {
                                // now try to check if directory ...
                                try {
                                    yield conn.client.list(FILE_OR_FOLDER);
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
                        else {
                            STAT.type = CACHED_VALUE;
                        }
                    }
                    catch (_d) {
                        STAT.type = vscode.FileType.SymbolicLink;
                    }
                }
            }
            else if ('-' === fi.type) {
                STAT.type = vscode.FileType.File;
            }
            if (vscode.FileType.File === STAT.type) {
                STAT.size = fi.size;
                STAT.ctime = fi.modifyTime;
                STAT.mtime = fi.modifyTime;
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
            return [fi.name, STAT];
        }
    });
}
function tryCloseConnection(conn) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (conn) {
                yield conn.client.end();
            }
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
function uriWithNewPath(uri, newPath) {
    if (uri) {
        return vscode.Uri.parse(`sftp://${uri.authority}${vscode_helpers.toStringSafe(newPath)}${vscode_helpers.isEmptyString(uri.query) ? '' : ('?' + uri.query)}`);
    }
}
//# sourceMappingURL=sftp.js.map