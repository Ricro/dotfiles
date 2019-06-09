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
Object.defineProperty(exports, "__esModule", { value: true });
const vscrw = require("./extension");
const vscode = require("vscode");
const vscode_helpers = require("vscode-helpers");
/**
 * SFTP file system.
 */
class FileSystemBase extends vscode_helpers.DisposableBase {
    /**
     * Initializes a new instance of that class.
     */
    constructor() {
        super();
        this._EVENT_EMITTER = new vscode.EventEmitter();
        this.onDidChangeFile = this._EVENT_EMITTER.event;
    }
    /**
     * Gets the logger for that file system provider.
     *
     * @return {vscode_helpers.Logger} The provider's logger.
     */
    get logger() {
        return vscrw.getLogger();
    }
    /**
     * Throw an exception if writing a file is not allowed.
     *
     * @param {vscode.FileStat|false} stat The file information.
     * @param {WriteFileOptions} options The options.
     * @param {vscode.Uri} [uri] The optional URI.
     */
    throwIfWriteFileIsNotAllowed(stat, options, uri) {
        if (false === stat) {
            if (!options.create) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
        }
        else {
            if (vscode.FileType.Directory === stat.type) {
                throw vscode.FileSystemError.FileIsADirectory(uri);
            }
            if (!options.overwrite) {
                throw vscode.FileSystemError.FileExists(uri);
            }
        }
    }
    /**
     * Throws an error fir an URI without authority.
     *
     * @param {vscode.Uri} uri The input URI.
     * @param {Function} errorFactory The function that returns the error object, based on the URI without the authority.
     */
    throwWithoutAuthority(uri, errorFactory) {
        const SAFE_URI = vscrw.uriWithoutAuthority(uri);
        const ERROR = errorFactory(SAFE_URI);
        if (ERROR) {
            throw ERROR;
        }
    }
}
exports.FileSystemBase = FileSystemBase;
//# sourceMappingURL=fs.js.map