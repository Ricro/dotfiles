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
const HTTPs = require("https");
const Path = require("path");
const Slack = require('@slack/client');
const URL = require("url");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("../extension");
const vscrw_fs = require("../fs");
/**
 * Slack file system.
 */
class SlackFileSystem extends vscrw_fs.FileSystemBase {
    /**
     * @inheritdoc
     */
    createDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            throw vscode.FileSystemError.NoPermissions(uri);
        });
    }
    /**
     * @inheritdoc
     */
    delete(uri, options) {
        return __awaiter(this, void 0, void 0, function* () {
            throw vscode.FileSystemError.NoPermissions(uri);
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
                    .trace(e, 'fs.slack.SlackFileSystem.forConnection()');
                throw e;
            }
        });
    }
    list(uri) {
        return this.forConnection(uri, (conn) => {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const ALL_FILES = [];
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
                        resolve(ALL_FILES);
                    }
                };
                try {
                    const STAT = yield this.statInner(uri);
                    if (vscode.FileType.Directory !== STAT.type) {
                        throw vscode.FileSystemError.FileNotADirectory(uri);
                    }
                    let currentPage = 0;
                    const NEXT_SEGMENT = () => {
                        try {
                            ++currentPage;
                            conn.client.files.list({
                                channel: conn.channel,
                                page: currentPage,
                            }, (err, info) => {
                                if (err) {
                                    COMPLETED(err);
                                    return;
                                }
                                try {
                                    vscode_helpers.asArray(info.files).forEach((f) => {
                                        ALL_FILES.push(f);
                                    });
                                    let isDone = true;
                                    if (info.paging) {
                                        isDone = currentPage >= info.paging.pages;
                                    }
                                    if (isDone) {
                                        COMPLETED(null);
                                    }
                                    else {
                                        NEXT_SEGMENT();
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
            // slack://token@channel[/]
            const PARAMS = vscrw.getUriParams(uri);
            let channel;
            let token = false;
            {
                // external auth file?
                let authFile = vscode_helpers.toStringSafe(PARAMS['auth']);
                if (!vscode_helpers.isEmptyString(authFile)) {
                    authFile = vscrw.mapToUsersHome(authFile);
                    if (yield vscode_helpers.isFile(authFile)) {
                        token = (yield FSExtra.readFile(authFile, 'utf8')).trim();
                    }
                }
            }
            const AUTHORITITY = vscode_helpers.toStringSafe(uri.authority);
            {
                const TOKEN_CHANNEL_SEP = AUTHORITITY.indexOf('@');
                if (TOKEN_CHANNEL_SEP > -1) {
                    if (false === token) {
                        token = AUTHORITITY.substr(0, TOKEN_CHANNEL_SEP).trim();
                    }
                    channel = AUTHORITITY.substr(TOKEN_CHANNEL_SEP + 1).toUpperCase().trim();
                }
            }
            if (false === token) {
                token = undefined;
            }
            if (vscode_helpers.isEmptyString(channel)) {
                channel = undefined;
            }
            if (vscode_helpers.isEmptyString(token)) {
                token = undefined;
            }
            return {
                channel: channel,
                client: new Slack.WebClient(token),
                token: token,
            };
        });
    }
    /**
     * @inheritdoc
     */
    readDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield this.list(uri)).map(f => {
                return [f.name, vscode.FileType.File];
            });
        });
    }
    /**
     * @inheritdoc
     */
    readFile(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.forConnection(uri, (conn) => {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    const COMPLETED = vscode_helpers.createCompletedAction(resolve, reject);
                    try {
                        const STAT = yield this.statInner(uri);
                        if (vscode.FileType.File !== STAT.type) {
                            throw vscode.FileSystemError.FileIsADirectory(uri);
                        }
                        if (_.isNil(conn.token)) {
                            throw vscode.FileSystemError.NoPermissions(uri);
                        }
                        if (vscode_helpers.isEmptyString(STAT.url_private_download)) {
                            throw vscode.FileSystemError.Unavailable(uri);
                        }
                        const DOWNLOAD_URL = URL.parse(STAT.url_private_download);
                        HTTPs.request({
                            hostname: DOWNLOAD_URL.host,
                            headers: {
                                'Authorization': `Bearer ${conn.token}`,
                            },
                            path: DOWNLOAD_URL.path,
                        }, (resp) => {
                            if (200 === resp.statusCode) {
                                vscode_helpers.readAll(resp).then((data) => {
                                    COMPLETED(null, data);
                                }, (err) => {
                                    COMPLETED(err);
                                });
                            }
                            else {
                                COMPLETED(new Error(`Unexpected response ${resp.statusCode}: '${resp.statusMessage}'`));
                            }
                        }).end();
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                }));
            });
        });
    }
    /**
     * Register file system to extension.
     *
     * @param {vscode.ExtensionContext} context The extension context.
     *
     * @return {SlackFileSystem} The registrated provider instance.
     */
    static register(context) {
        const NEW_FS = new SlackFileSystem();
        try {
            context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SlackFileSystem.scheme, NEW_FS, {
                isCaseSensitive: false,
                isReadonly: true,
            }));
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
            throw vscode.FileSystemError.NoPermissions(oldUri);
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
        return this.forConnection(uri, (conn) => __awaiter(this, void 0, void 0, function* () {
            if ('/' === vscrw.normalizePath(uri.path)) {
                if (!_.isNil(conn.channel)) {
                    return {
                        type: vscode.FileType.Directory,
                        ctime: 0,
                        mtime: 0,
                        size: 0,
                    };
                }
            }
            if (!_.isNil(conn.channel)) {
                if (2 === uri.path.split('/').length) {
                    const PATH = vscrw.normalizePath(vscode_helpers.normalizeString(uri.path));
                    const PARENT_PATH = Path.dirname(uri.path);
                    const PARENT_URI = uriWithNewPath(uri, PARENT_PATH);
                    const FOUND_FILE = vscode_helpers.from(yield this.list(PARENT_URI)).orderByDescending(f => {
                        return f.created;
                    }).thenByDescending(f => {
                        return f.timestamp;
                    }).firstOrDefault(f => {
                        return PATH === vscrw.normalizePath(vscode_helpers.normalizeString(f.name));
                    }, false);
                    if (false !== FOUND_FILE) {
                        const STAT = {
                            ctime: parseInt(vscode_helpers.toStringSafe(FOUND_FILE.created).trim()),
                            id: vscode_helpers.toStringSafe(FOUND_FILE.id).trim(),
                            internal_name: vscode_helpers.toStringSafe(FOUND_FILE.internal_name).trim(),
                            mtime: parseInt(vscode_helpers.toStringSafe(FOUND_FILE.timestamp).trim()),
                            size: parseInt(vscode_helpers.toStringSafe(FOUND_FILE.size).trim()),
                            type: vscode.FileType.File,
                            url_private_download: FOUND_FILE.url_private_download,
                        };
                        if (isNaN(STAT.ctime)) {
                            STAT.ctime = 0;
                        }
                        if ('' === STAT.id) {
                            STAT.id = undefined;
                        }
                        if ('' === STAT.internal_name) {
                            STAT.internal_name = undefined;
                        }
                        if (isNaN(STAT.mtime)) {
                            STAT.mtime = 0;
                        }
                        if (isNaN(STAT.size)) {
                            STAT.size = 0;
                        }
                        return STAT;
                    }
                }
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }));
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
            throw vscode.FileSystemError.NoPermissions(uri);
        });
    }
}
/**
 * Stores the name of the scheme.
 */
SlackFileSystem.scheme = 'slack';
exports.SlackFileSystem = SlackFileSystem;
function uriWithNewPath(uri, newPath) {
    if (uri) {
        return vscode.Uri.parse(`slack://${uri.authority}${vscrw.normalizePath(newPath)}${vscode_helpers.isEmptyString(uri.query) ? '' : ('?' + uri.query)}`);
    }
}
//# sourceMappingURL=slack.js.map