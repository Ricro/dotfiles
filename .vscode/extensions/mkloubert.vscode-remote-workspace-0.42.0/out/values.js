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
const _ = require("lodash");
const FSExtra = require("fs-extra");
const OS = require("os");
const Path = require("path");
const vscode_helpers = require("vscode-helpers");
const vscrw = require("./extension");
const vscrw_code = require("./code");
/**
 * Applies values / placeholders from an external (JSON) file.
 *
 * @param {string} valuesFile The path to the JSON file.
 * @param {object} params The object where the values should be applied to.
 */
function applyExternalValues(valuesFile, params) {
    if (vscode_helpers.isEmptyString(valuesFile)) {
        return; // no file defined
    }
    if (_.isNil(params)) {
        return; // no params to apply to
    }
    if (!Path.isAbsolute(valuesFile)) {
        // map to home directory
        valuesFile = Path.join(OS.homedir(), valuesFile);
    }
    valuesFile = Path.resolve(valuesFile);
    const VALUE_STORAGE = JSON.parse(FSExtra.readFileSync(valuesFile, 'utf8'));
    if (_.isNil(VALUE_STORAGE)) {
        return;
    }
    const PLACEHOLDERS = {};
    const CODE_CACHE = {};
    const PARAMS_TO_EXCLUDE = vscode_helpers.from(vscode_helpers.asArray(VALUE_STORAGE.exclude)).select(p => vscode_helpers.normalizeString(p))
        .toArray();
    // first from file
    if (!_.isNil(VALUE_STORAGE.values)) {
        _.forIn(VALUE_STORAGE.values, (v, k) => {
            PLACEHOLDERS[vscode_helpers.normalizeString(k)] = (input) => getValueStorageValue(input, VALUE_STORAGE.values[k], CODE_CACHE);
        });
    }
    // import environment variables?
    const IMPORT_ENV_VARS = vscode_helpers.toBooleanSafe(VALUE_STORAGE.importEnvVars);
    if (IMPORT_ENV_VARS) {
        _.forIn(process.env, (v, k) => {
            PLACEHOLDERS[vscode_helpers.normalizeString(k)] = () => process.env[k];
        });
    }
    // now replace values
    _.forIn(params, (v, k) => {
        if (PARAMS_TO_EXCLUDE.indexOf(k) > -1) {
            return; // excluded
        }
        let str = vscode_helpers.toStringSafe(v);
        // ${VALUE_NAME}
        str = str.replace(/(\$)(\{)([^\}]*)(\})/gm, (match, varIdentifier, openBracket, varName, closedBracked) => {
            let newValue;
            const PROVIDER = PLACEHOLDERS[vscode_helpers.normalizeString(varName)];
            if (!_.isNil(PROVIDER)) {
                try {
                    newValue = PROVIDER(v);
                }
                catch (e) {
                    vscrw.getLogger()
                        .trace(e, 'values.applyExternalValues(1)');
                }
            }
            if (_.isUndefined(newValue)) {
                newValue = match;
            }
            return vscode_helpers.toStringSafe(newValue);
        });
        params[k] = str;
    });
}
exports.applyExternalValues = applyExternalValues;
function getValueStorageValue(input, v, cache) {
    let value;
    if (!_.isNil(v)) {
        if (_.isString(v)) {
            value = v;
        }
        else {
            switch (vscode_helpers.normalizeString(v.type)) {
                case '':
                case 'static':
                    {
                        const STATIC_ENTRY = v;
                        value = STATIC_ENTRY.value;
                    }
                    break;
                case 'code':
                case 'js':
                    {
                        const CODE_ENTRY = v;
                        value = vscrw_code.exec({
                            code: CODE_ENTRY.code,
                            values: {
                                'cache': cache,
                            },
                        });
                    }
                    break;
                case 'env':
                    {
                        const ENV_ENTRY = v;
                        const ENV_NAME = vscode_helpers.normalizeString(ENV_ENTRY.name);
                        _.forIn(process.env, (v, k) => {
                            if (ENV_NAME === vscode_helpers.normalizeString(k)) {
                                value = process.env[k];
                            }
                        });
                    }
                    break;
            }
        }
    }
    if (!_.isNil(value)) {
        value = vscode_helpers.toStringSafe(value);
    }
    return value;
}
//# sourceMappingURL=values.js.map