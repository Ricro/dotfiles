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
const AWS = require("aws-sdk");
const MimeTypes = require("mime-types");
const Moment = require("moment");
const OS = require("os");
const Path = require("path");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
const DEFAULT_ACL = 'private';
const DEFAULT_CREDENTIAL_TYPE = 'shared';
const KNOWN_CREDENTIAL_CLASSES = {
    'environment': AWS.EnvironmentCredentials,
    'file': AWS.FileSystemCredentials,
    'shared': AWS.SharedIniFileCredentials,
};
/**
 * S3 file system.
 */
class S3FileSystem extends vscrw_fs.FileSystemBase {
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
                yield conn.client.putObject({
                    Bucket: undefined,
                    ACL: yield this.getACL(uri),
                    Key: toS3Path(uri.path) + '/',
                    Body: null,
                }).promise();
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
                    const SELF_PATH = toS3Path(uri.path) + '/';
                    const DELETE_SELF_ACTION = () => __awaiter(this, void 0, void 0, function* () {
                        let deleteSelf = false;
                        try {
                            const DIR = yield conn.client.getObject({
                                Bucket: undefined,
                                Key: SELF_PATH
                            }).promise();
                            if (DIR) {
                                deleteSelf = true;
                            }
                        }
                        catch (_a) { }
                        if (deleteSelf) {
                            yield conn.client.deleteObject({
                                Bucket: this.getBucket(uri),
                                Key: SELF_PATH,
                            }).promise();
                        }
                    });
                    const LIST = yield this.list(uri, true);
                    const SUB_ITEMS = LIST.filter(x => {
                        return SELF_PATH !== x.Key;
                    });
                    const HAS_SUB_DIRS = (yield this.readDirectory(uri)).filter(e => {
                        return vscode.FileType.Directory === e[1];
                    }).length > 0;
                    if (!options.recursive) {
                        if (HAS_SUB_DIRS) {
                            throw vscode.FileSystemError.NoPermissions(uri);
                        }
                    }
                    for (const SI of SUB_ITEMS) {
                        yield conn.client.deleteObject({
                            Bucket: this.getBucket(uri),
                            Key: SI.Key,
                        }).promise();
                    }
                    yield DELETE_SELF_ACTION();
                }
                else {
                    yield conn.client.deleteObject({
                        Bucket: this.getBucket(uri),
                        Key: toS3Path(uri.path),
                    }).promise();
                }
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
                    .trace(e, 'fs.s3.S3FileSystem.forConnection()');
                throw e;
            }
        });
    }
    getACL(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            const PARAMS = vscrw.getUriParams(uri);
            let acl = vscode_helpers.normalizeString(PARAMS['acl']);
            if ('' === acl) {
                acl = yield this.getDefaultAcl();
            }
            return acl;
        });
    }
    getDefaultAcl() {
        return __awaiter(this, void 0, void 0, function* () {
            return DEFAULT_ACL;
        });
    }
    getBucket(uri) {
        let bucket;
        const AUTHORITITY = vscode_helpers.toStringSafe(uri.authority);
        {
            const AUTH_HOST_SEP = AUTHORITITY.indexOf('@');
            if (AUTH_HOST_SEP > -1) {
                bucket = AUTHORITITY.substr(AUTH_HOST_SEP + 1);
            }
            else {
                bucket = AUTHORITITY;
            }
        }
        if (vscode_helpers.isEmptyString(bucket)) {
            bucket = 'vscode-remote-workspace';
        }
        return bucket.trim();
    }
    list(uri, recursive = false) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const PATH = vscrw.normalizePath(uri.path);
                const PATH_PARTS = PATH.split('/').filter(x => {
                    return !vscode_helpers.isEmptyString(x);
                });
                const OBJECTS = [];
                const HANDLE_RESULT = (result) => __awaiter(this, void 0, void 0, function* () {
                    if (!result) {
                        return;
                    }
                    vscode_helpers.asArray(result.Contents).forEach(o => {
                        OBJECTS.push(o);
                    });
                });
                let currentContinuationToken = false;
                const NEXT_SEGMENT = () => __awaiter(this, void 0, void 0, function* () {
                    if (false !== currentContinuationToken) {
                        if (vscode_helpers.isEmptyString(currentContinuationToken)) {
                            return;
                        }
                    }
                    else {
                        currentContinuationToken = undefined;
                    }
                    const PARAMS = {
                        Bucket: undefined,
                        ContinuationToken: currentContinuationToken,
                        Prefix: '/' === PATH ? '' : (toS3Path(PATH) + '/'),
                    };
                    try {
                        const RESULT = yield conn.client.listObjectsV2(PARAMS)
                            .promise();
                        currentContinuationToken = RESULT.NextContinuationToken;
                        yield HANDLE_RESULT(RESULT);
                        yield NEXT_SEGMENT();
                    }
                    catch (e) {
                        throw e;
                    }
                });
                yield NEXT_SEGMENT();
                return OBJECTS.filter(o => {
                    const KEY = vscode_helpers.normalizeString(o.Key);
                    return '' !== KEY &&
                        '/' !== KEY;
                }).filter(o => {
                    if (recursive) {
                        return true;
                    }
                    const KEY = vscode_helpers.toStringSafe(o.Key);
                    const KEY_PARTS = KEY.split('/').filter(x => {
                        return !vscode_helpers.isEmptyString(x);
                    });
                    return PATH_PARTS.length === (KEY_PARTS.length - 1);
                }).sort((x, y) => {
                    return vscode_helpers.compareValuesBy(x, y, o => {
                        return vscode_helpers.normalizeString(o.Key);
                    });
                });
            }));
        });
    }
    openConnection(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            // format:
            //
            // s3://[credential_type@]bucket[/path/to/file/or/folder]
            const PARAMS = vscrw.getUriParams(uri);
            const AWS_DIR = Path.resolve(Path.join(OS.homedir(), '.aws'));
            const AS_FULL_PATH = (p) => {
                p = vscode_helpers.toStringSafe(p);
                if (!Path.isAbsolute(p)) {
                    p = Path.join(AWS_DIR, p);
                }
                return Path.resolve(p);
            };
            let credentialClass;
            let credentialConfig;
            let credentialType;
            const AUTHORITITY = vscode_helpers.toStringSafe(uri.authority);
            {
                const AUTH_HOST_SEP = AUTHORITITY.indexOf('@');
                if (AUTH_HOST_SEP > -1) {
                    credentialType = vscode_helpers.normalizeString(AUTHORITITY.substr(0, AUTH_HOST_SEP));
                    if ('' === credentialType) {
                        credentialType = DEFAULT_CREDENTIAL_TYPE;
                    }
                }
                else {
                    credentialType = DEFAULT_CREDENTIAL_TYPE;
                }
                credentialClass = KNOWN_CREDENTIAL_CLASSES[credentialType];
            }
            if (!credentialClass) {
                throw new Error(`Credential type '${credentialType}' is not supported!`);
            }
            switch (credentialType) {
                case 'environment':
                    {
                        const VAR_NAME = vscode_helpers.toStringSafe(PARAMS['varprefix']).toUpperCase().trim();
                        if ('' !== VAR_NAME) {
                            credentialConfig = VAR_NAME;
                        }
                    }
                    break;
                case 'file':
                    {
                        let credentialFile = vscode_helpers.toStringSafe(PARAMS['file']);
                        if (!Path.isAbsolute(credentialFile)) {
                            credentialFile = Path.resolve(Path.join(AWS_DIR, credentialFile));
                        }
                        this.logger
                            .info(`Using credential file '${credentialFile}'`, 'fs.s3.S3FileSystem.openConnection(file)');
                        credentialConfig = credentialFile;
                    }
                    break;
                case 'shared':
                    {
                        const OPTS = {
                            profile: vscode_helpers.toStringSafe(PARAMS['profile']).trim(),
                        };
                        if ('' === OPTS.profile) {
                            OPTS.profile = undefined;
                        }
                        credentialConfig = OPTS;
                    }
                    break;
            }
            let endpoint = vscode_helpers.toStringSafe(PARAMS['endpoint']);
            if (vscode_helpers.isEmptyString(endpoint)) {
                endpoint = undefined;
            }
            let api = vscode_helpers.toStringSafe(PARAMS['api']).trim();
            if ('' === api) {
                api = undefined;
            }
            let logger;
            if (vscrw.isTrue(PARAMS['debug'])) {
                logger = {
                    log: (...messages) => {
                        try {
                            for (const M of messages) {
                                this.logger
                                    .info(M, 's3');
                            }
                        }
                        catch (_a) { }
                    }
                };
            }
            const S3 = {
                client: new AWS.S3({
                    apiVersion: api,
                    logger: logger,
                    credentials: new credentialClass(credentialConfig),
                    endpoint: endpoint,
                    params: {
                        Bucket: this.getBucket(uri),
                        ACL: this.getDefaultAcl(),
                    },
                }),
            };
            return S3;
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
                for (const O of yield this.list(uri)) {
                    const KEY = vscode_helpers.toStringSafe(O.Key);
                    const NEW_ENTRY = [
                        Path.basename(vscrw.normalizePath(KEY)),
                        vscode.FileType.Unknown,
                    ];
                    if (KEY.endsWith('/')) {
                        NEW_ENTRY[1] = vscode.FileType.Directory;
                    }
                    else {
                        NEW_ENTRY[1] = vscode.FileType.File;
                    }
                    ENTRIES.push(NEW_ENTRY);
                }
                return vscode_helpers.from(ENTRIES).orderBy(e => {
                    return vscode.FileType.Directory === e[1] ? 0 : 1;
                }).toArray();
            }));
        });
    }
    /**
     * @inheritdoc
     */
    readFile(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                const PARAMS = {
                    Bucket: undefined,
                    Key: toS3Path(uri.path),
                };
                const DATA = yield conn.client.getObject(PARAMS)
                    .promise();
                let result = yield vscode_helpers.asBuffer(DATA.Body);
                if (!Buffer.isBuffer(result)) {
                    result = Buffer.alloc(0);
                }
                return result;
            }));
        });
    }
    /**
     * Register file system to extension.
     *
     * @param {vscode.ExtensionContext} context The extension context.
     *
     * @return {S3FileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new S3FileSystem();
        try {
            context.subscriptions.push(vscode.workspace.registerFileSystemProvider(S3FileSystem.scheme, NEW_FS, { isCaseSensitive: true }));
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
                const OLD_STAT = yield this.statInner(oldUri);
                const NEW_STAT = yield this.tryGetStat(newUri);
                if (false !== NEW_STAT) {
                    if (!options.overwrite) {
                        throw vscode.FileSystemError.FileExists(newUri);
                    }
                    if (vscode.FileType.File === NEW_STAT.type) {
                        yield conn.client.deleteObject({
                            Bucket: this.getBucket(newUri),
                            Key: toS3Path(newUri.path),
                        }).promise();
                    }
                }
                const ITEMS_TO_MOVE = [];
                const ITEMS_TO_DELETE = [];
                const END_ACTIONS = [];
                if (vscode.FileType.Directory === OLD_STAT.type) {
                    const LIST = yield this.list(oldUri, true);
                    const OLD_DIR = toS3Path(oldUri.path) + '/';
                    ITEMS_TO_DELETE.push(OLD_DIR);
                    const NEW_DIR = toS3Path(newUri.path) + '/';
                    for (const F of LIST) {
                        const OLD_PATH = F.Key;
                        const NEW_PATH = NEW_DIR + OLD_PATH.substr(OLD_DIR.length);
                        ITEMS_TO_MOVE.push({
                            oldPath: OLD_PATH,
                            newPath: NEW_PATH,
                        });
                    }
                    END_ACTIONS.push(() => __awaiter(this, void 0, void 0, function* () {
                        try {
                            const DIR = yield conn.client.getObject({
                                Bucket: undefined,
                                Key: OLD_DIR
                            }).promise();
                            if (DIR) {
                                yield conn.client.deleteObject({
                                    Bucket: yield this.getACL(oldUri),
                                    Key: OLD_DIR,
                                }).promise();
                            }
                        }
                        catch (_a) { }
                    }));
                    END_ACTIONS.push(() => __awaiter(this, void 0, void 0, function* () {
                        let createNewDir = true;
                        try {
                            const DIR = yield conn.client.getObject({
                                Bucket: undefined,
                                Key: NEW_DIR
                            }).promise();
                            if (DIR) {
                                createNewDir = false;
                            }
                        }
                        catch (_b) { }
                        if (createNewDir) {
                            yield conn.client.putObject({
                                Bucket: undefined,
                                ACL: yield this.getACL(newUri),
                                Key: NEW_DIR,
                                Body: null,
                            }).promise();
                        }
                    }));
                }
                else {
                    ITEMS_TO_MOVE.push({
                        oldPath: toS3Path(oldUri.path),
                        newPath: toS3Path(newUri.path),
                    });
                }
                for (const I of ITEMS_TO_MOVE) {
                    const OLD_BUCKET = this.getBucket(oldUri);
                    const OLD_PATH = I.oldPath;
                    const NEW_PATH = I.newPath;
                    yield conn.client.copyObject({
                        Bucket: OLD_BUCKET,
                        CopySource: `${OLD_BUCKET}/${OLD_PATH}`,
                        Key: NEW_PATH,
                    }).promise();
                    yield conn.client.deleteObject({
                        Bucket: OLD_BUCKET,
                        Key: OLD_PATH,
                    }).promise();
                }
                for (const I of ITEMS_TO_DELETE) {
                    const OLD_BUCKET = this.getBucket(oldUri);
                    yield conn.client.deleteObject({
                        Bucket: OLD_BUCKET,
                        Key: I,
                    }).promise();
                }
                for (const A of END_ACTIONS) {
                    yield Promise.resolve(A());
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
                    const FILE = yield conn.client.getObject({
                        Bucket: undefined,
                        Key: toS3Path(PATH)
                    }).promise();
                    if (FILE) {
                        result = {
                            ctime: undefined,
                            mtime: undefined,
                            size: parseInt(vscode_helpers.normalizeString(FILE.ContentLength)),
                            type: vscode.FileType.File,
                        };
                        if (FILE.LastModified) {
                            result.mtime = Moment(FILE.LastModified).unix();
                        }
                    }
                }
                catch (_a) { }
                if (false === result) {
                    const DIR = yield conn.client.getObject({
                        Bucket: undefined,
                        Key: toS3Path(PATH) + '/'
                    }).promise();
                    if (DIR) {
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
    /**
     * @inheritdoc
     */
    writeFile(uri, content, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
                this.throwIfWriteFileIsNotAllowed(yield this.tryGetStat(uri), options, uri);
                const PATH = vscrw.normalizePath(uri.path);
                let contentType = MimeTypes.lookup(Path.basename(PATH));
                if (false === contentType) {
                    contentType = 'application/octet-stream';
                }
                const PARAMS = {
                    ACL: yield this.getACL(uri),
                    Bucket: undefined,
                    ContentType: contentType,
                    Key: toS3Path(PATH),
                    Body: vscrw.asBuffer(content),
                };
                yield conn.client.putObject(PARAMS)
                    .promise();
            }));
        });
    }
}
/**
 * Stores the name of the scheme.
 */
S3FileSystem.scheme = 's3';
exports.S3FileSystem = S3FileSystem;
function toS3Path(p) {
    return vscrw.normalizePath(p)
        .substr(1);
}
//# sourceMappingURL=s3.js.map