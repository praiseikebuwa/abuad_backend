"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.qs = exports.q = exports.p = void 0;
/** Cast a route param or query value to string safely */
const p = (val) => {
    if (Array.isArray(val))
        return val[0] || '';
    return val || '';
};
exports.p = p;
/** Cast a query value to string or undefined */
const q = (val) => {
    if (!val)
        return undefined;
    if (Array.isArray(val))
        return String(val[0]);
    return String(val);
};
exports.q = q;
/** Cast a query value to string with default */
const qs = (val, defaultVal = '') => {
    if (!val)
        return defaultVal;
    if (Array.isArray(val))
        return String(val[0] || defaultVal);
    return String(val) || defaultVal;
};
exports.qs = qs;
