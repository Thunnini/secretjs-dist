"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const encoding_1 = require("@iov/encoding");
const axios_1 = __importDefault(require("axios"));
const types_1 = require("./types");
const enigmautils_1 = __importDefault(require("./enigmautils"));
function normalizeArray(backend) {
    return backend || [];
}
/**
 * The mode used to send transaction
 *
 * @see https://cosmos.network/rpc/#/Transactions/post_txs
 */
var BroadcastMode;
(function (BroadcastMode) {
    /** Return after tx commit */
    BroadcastMode["Block"] = "block";
    /** Return afer CheckTx */
    BroadcastMode["Sync"] = "sync";
    /** Return right away */
    BroadcastMode["Async"] = "async";
})(BroadcastMode = exports.BroadcastMode || (exports.BroadcastMode = {}));
function isWasmError(resp) {
    return resp.error !== undefined;
}
function unwrapWasmResponse(response) {
    if (isWasmError(response)) {
        throw new Error(response.error);
    }
    return response.result;
}
// We want to get message data from 500 errors
// https://stackoverflow.com/questions/56577124/how-to-handle-500-error-message-with-axios
// this should be chained to catch one error and throw a more informative one
function parseAxiosError(err) {
    var _a;
    // use the error message sent from server, not default 500 msg
    if ((_a = err.response) === null || _a === void 0 ? void 0 : _a.data) {
        let errorText;
        const data = err.response.data;
        // expect { error: string }, but otherwise dump
        if (data.error && typeof data.error === "string") {
            errorText = data.error;
        }
        else if (typeof data === "string") {
            errorText = data;
        }
        else {
            errorText = JSON.stringify(data);
        }
        throw new Error(`${errorText} (HTTP ${err.response.status})`);
    }
    else {
        throw err;
    }
}
class RestClient {
    /**
     * Creates a new client to interact with a Cosmos SDK light client daemon.
     * This class tries to be a direct mapping onto the API. Some basic decoding and normalizatin is done
     * but things like caching are done at a higher level.
     *
     * When building apps, you should not need to use this class directly. If you do, this indicates a missing feature
     * in higher level components. Feel free to raise an issue in this case.
     *
     * @param apiUrl The URL of a Cosmos SDK light client daemon API (sometimes called REST server or REST API)
     * @param broadcastMode Defines at which point of the transaction processing the postTx method (i.e. transaction broadcasting) returns
     * @param seed - The seed used to generate sender TX encryption key. If empty will generate random new one
     */
    constructor(apiUrl, broadcastMode = BroadcastMode.Block, seed) {
        const headers = {
            post: { "Content-Type": "application/json" },
        };
        this.client = axios_1.default.create({
            baseURL: apiUrl,
            headers: headers,
        });
        this.broadcastMode = broadcastMode;
        this.enigmautils = new enigmautils_1.default(apiUrl, seed);
        this.codeHashCache = new Map();
    }
    async get(path) {
        const { data } = await this.client.get(path).catch(parseAxiosError);
        if (data === null) {
            throw new Error("Received null response from server");
        }
        return data;
    }
    async post(path, params) {
        if (!encoding_1.isNonNullObject(params))
            throw new Error("Got unexpected type of params. Expected object.");
        const { data } = await this.client.post(path, params).catch(parseAxiosError);
        if (data === null) {
            throw new Error("Received null response from server");
        }
        return data;
    }
    // The /auth endpoints
    async authAccounts(address) {
        const path = `/auth/accounts/${address}`;
        const responseData = await this.get(path);
        if (responseData.result.type !== "cosmos-sdk/Account") {
            throw new Error("Unexpected response data format");
        }
        return responseData;
    }
    // The /blocks endpoints
    async blocksLatest() {
        const responseData = await this.get("/blocks/latest");
        if (!responseData.block) {
            throw new Error("Unexpected response data format");
        }
        return responseData;
    }
    async blocks(height) {
        const responseData = await this.get(`/blocks/${height}`);
        if (!responseData.block) {
            throw new Error("Unexpected response data format");
        }
        return responseData;
    }
    // The /node_info endpoint
    async nodeInfo() {
        const responseData = await this.get("/node_info");
        if (!responseData.node_info) {
            throw new Error("Unexpected response data format");
        }
        return responseData;
    }
    // The /txs endpoints
    async txById(id) {
        const responseData = await this.get(`/txs/${id}`);
        if (!responseData.tx) {
            throw new Error("Unexpected response data format");
        }
        return this.decryptTxsResponse(responseData);
    }
    async txsQuery(query) {
        const responseData = await this.get(`/txs?${query}`);
        if (!responseData.txs) {
            throw new Error("Unexpected response data format");
        }
        const resp = responseData;
        for (let i = 0; i < resp.txs.length; i++) {
            resp.txs[i] = await this.decryptTxsResponse(resp.txs[i]);
        }
        return resp;
    }
    /** returns the amino-encoding of the transaction performed by the server */
    async encodeTx(tx) {
        const responseData = await this.post("/txs/encode", tx);
        if (!responseData.tx) {
            throw new Error("Unexpected response data format");
        }
        return encoding_1.Encoding.fromBase64(responseData.tx);
    }
    /**
     * Broadcasts a signed transaction to into the transaction pool.
     * Depending on the RestClient's broadcast mode, this might or might
     * wait for checkTx or deliverTx to be executed before returning.
     *
     * @param tx a signed transaction as StdTx (i.e. not wrapped in type/value container)
     */
    async postTx(tx) {
        const params = {
            tx: tx,
            mode: this.broadcastMode,
        };
        const responseData = await this.post("/txs", params);
        if (!responseData.txhash) {
            throw new Error("Unexpected response data format");
        }
        return responseData;
    }
    // The /wasm endpoints
    // wasm rest queries are listed here: https://github.com/cosmwasm/wasmd/blob/master/x/wasm/client/rest/query.go#L19-L27
    async listCodeInfo() {
        const path = `/wasm/code`;
        const responseData = (await this.get(path));
        return normalizeArray(await unwrapWasmResponse(responseData));
    }
    // this will download the original wasm bytecode by code id
    // throws error if no code with this id
    async getCode(id) {
        const path = `/wasm/code/${id}`;
        const responseData = (await this.get(path));
        return await unwrapWasmResponse(responseData);
    }
    async listContractsByCodeId(id) {
        const path = `/wasm/code/${id}/contracts`;
        const responseData = (await this.get(path));
        return normalizeArray(await unwrapWasmResponse(responseData));
    }
    async getCodeHashByCodeId(id) {
        const codeHashFromCache = this.codeHashCache.get(id);
        if (typeof codeHashFromCache === "string") {
            return codeHashFromCache;
        }
        const path = `/wasm/code/${id}/hash`;
        const responseData = (await this.get(path));
        this.codeHashCache.set(id, responseData.result);
        return responseData.result;
    }
    async getCodeHashByContractAddr(addr) {
        const codeHashFromCache = this.codeHashCache.get(addr);
        if (typeof codeHashFromCache === "string") {
            return codeHashFromCache;
        }
        const path = `/wasm/contract/${addr}/code-hash`;
        const responseData = (await this.get(path));
        this.codeHashCache.set(addr, responseData.result);
        return responseData.result;
    }
    /**
     * Returns null when contract was not found at this address.
     */
    async getContractInfo(address) {
        const path = `/wasm/contract/${address}`;
        const response = (await this.get(path));
        return await unwrapWasmResponse(response);
    }
    // Returns all contract state.
    // This is an empty array if no such contract, or contract has no data.
    async getAllContractState(address) {
        const path = `/wasm/contract/${address}/state`;
        const responseData = (await this.get(path));
        return normalizeArray(await unwrapWasmResponse(responseData)).map(types_1.parseWasmData);
    }
    // Returns the data at the key if present (unknown decoded json),
    // or null if no data at this (contract address, key) pair
    async queryContractRaw(address, key) {
        const hexKey = encoding_1.Encoding.toHex(key);
        const path = `/wasm/contract/${address}/raw/${hexKey}?encoding=hex`;
        const responseData = (await this.get(path));
        const data = await unwrapWasmResponse(responseData);
        return data.length === 0 ? null : encoding_1.Encoding.fromBase64(data[0].val);
    }
    /**
     * Makes a smart query on the contract and parses the reponse as JSON.
     * Throws error if no such contract exists, the query format is invalid or the response is invalid.
     */
    async queryContractSmart(address, query) {
        const contractCodeHash = await this.getCodeHashByContractAddr(address);
        const encrypted = await this.enigmautils.encrypt(contractCodeHash, query);
        const nonce = encrypted.slice(0, 32);
        const encoded = encoding_1.Encoding.toHex(encoding_1.Encoding.toUtf8(encoding_1.Encoding.toBase64(encrypted)));
        const path = `/wasm/contract/${address}/query/${encoded}?encoding=hex`;
        let responseData;
        try {
            responseData = (await this.get(path));
        }
        catch (err) {
            try {
                const errorMessageRgx = /contract failed: encrypted: (.+?) \(HTTP 500\)/g;
                const rgxMatches = errorMessageRgx.exec(err.message);
                if (rgxMatches == null || rgxMatches.length != 2) {
                    throw err;
                }
                const errorCipherB64 = rgxMatches[1];
                const errorCipherBz = encoding_1.Encoding.fromBase64(errorCipherB64);
                const errorPlainBz = await this.enigmautils.decrypt(errorCipherBz, nonce);
                err.message = err.message.replace(errorCipherB64, encoding_1.Encoding.fromUtf8(errorPlainBz));
            }
            catch (decryptionError) {
                throw new Error(`Failed to decrypt the following error message: ${err.message}. Decryption error of the error message: ${decryptionError.message}`);
            }
            throw err;
        }
        if (isWasmError(responseData)) {
            throw new Error(JSON.stringify(await this.enigmautils.decrypt(encoding_1.Encoding.fromBase64(responseData.error), nonce)));
        }
        // By convention, smart queries must return a valid JSON document (see https://github.com/CosmWasm/cosmwasm/issues/144)
        return JSON.parse(encoding_1.Encoding.fromUtf8(encoding_1.Encoding.fromBase64(encoding_1.Encoding.fromUtf8(await this.enigmautils.decrypt(encoding_1.Encoding.fromBase64(responseData.result.smart), nonce)))));
    }
    /**
     * Get the consensus keypair for IO encryption
     */
    async getMasterCerts(address, query) {
        return this.get("/register/master-cert");
    }
    async decryptDataField(dataField = "", nonce) {
        const wasmOutputDataCipherBz = encoding_1.Encoding.fromHex(dataField);
        // data
        const data = encoding_1.Encoding.fromBase64(encoding_1.Encoding.fromUtf8(await this.enigmautils.decrypt(wasmOutputDataCipherBz, nonce)));
        return data;
    }
    async decryptLogs(logs, nonce) {
        for (const l of logs) {
            for (const e of l.events) {
                if (e.type === "wasm") {
                    for (const a of e.attributes) {
                        try {
                            a.key = encoding_1.Encoding.fromUtf8(await this.enigmautils.decrypt(encoding_1.Encoding.fromBase64(a.key), nonce));
                        }
                        catch (e) { }
                        try {
                            a.value = encoding_1.Encoding.fromUtf8(await this.enigmautils.decrypt(encoding_1.Encoding.fromBase64(a.value), nonce));
                        }
                        catch (e) { }
                    }
                }
            }
        }
        return logs;
    }
    async decryptTxsResponse(txsResponse) {
        if (txsResponse.tx.value.msg.length === 1) {
            const msg = txsResponse.tx.value.msg[0];
            let inputMsgEncrypted;
            if (msg.type === "wasm/MsgExecuteContract") {
                inputMsgEncrypted = encoding_1.Encoding.fromBase64(msg.value.msg);
            }
            else if (msg.type === "wasm/MsgInstantiateContract") {
                inputMsgEncrypted = encoding_1.Encoding.fromBase64(msg.value.init_msg);
            }
            else {
                return txsResponse;
            }
            const inputMsgPubkey = inputMsgEncrypted.slice(32, 64);
            if (encoding_1.Encoding.toBase64(await this.enigmautils.getPubkey()) === encoding_1.Encoding.toBase64(inputMsgPubkey)) {
                // my pubkey, can decrypt
                const nonce = inputMsgEncrypted.slice(0, 32);
                // decrypt input
                const inputMsg = encoding_1.Encoding.fromUtf8(await this.enigmautils.decrypt(inputMsgEncrypted.slice(64), nonce));
                if (msg.type === "wasm/MsgExecuteContract") {
                    txsResponse.tx.value.msg[0].value.msg = inputMsg;
                }
                else if (msg.type === "wasm/MsgInstantiateContract") {
                    txsResponse.tx.value.msg[0].value.init_msg = inputMsg;
                }
                // decrypt output
                txsResponse.data = await this.decryptDataField(txsResponse.data, nonce);
                let logs;
                if (txsResponse.logs) {
                    logs = await this.decryptLogs(txsResponse.logs, nonce);
                    txsResponse = Object.assign({}, txsResponse, { logs: logs });
                }
                // decrypt error
                const errorMessageRgx = /contract failed: encrypted: (.+?): failed to execute message; message index: 0/g;
                const rgxMatches = errorMessageRgx.exec(txsResponse.raw_log);
                if (Array.isArray(rgxMatches) && rgxMatches.length === 2) {
                    const errorCipherB64 = rgxMatches[1];
                    const errorCipherBz = encoding_1.Encoding.fromBase64(errorCipherB64);
                    const errorPlainBz = await this.enigmautils.decrypt(errorCipherBz, nonce);
                    txsResponse.raw_log = txsResponse.raw_log.replace(errorCipherB64, encoding_1.Encoding.fromUtf8(errorPlainBz));
                }
            }
        }
        return txsResponse;
    }
}
exports.RestClient = RestClient;
//# sourceMappingURL=restclient.js.map