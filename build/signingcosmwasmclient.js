"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("@iov/crypto");
const encoding_1 = require("@iov/encoding");
const pako_1 = __importDefault(require("pako"));
const builder_1 = require("./builder");
const cosmwasmclient_1 = require("./cosmwasmclient");
const encoding_2 = require("./encoding");
const logs_1 = require("./logs");
const restclient_1 = require("./restclient");
function singleAmount(amount, denom) {
    return [{ amount: amount.toString(), denom: denom }];
}
function prepareBuilder(buider) {
    if (buider === undefined) {
        return ""; // normalization needed by backend
    }
    else {
        if (!builder_1.isValidBuilder(buider))
            throw new Error("The builder (Docker Hub image with tag) is not valid");
        return buider;
    }
}
const defaultFees = {
    upload: {
        amount: singleAmount(25000, "ucosm"),
        gas: "1000000",
    },
    init: {
        amount: singleAmount(12500, "ucosm"),
        gas: "500000",
    },
    exec: {
        amount: singleAmount(5000, "ucosm"),
        gas: "200000",
    },
    send: {
        amount: singleAmount(2000, "ucosm"),
        gas: "80000",
    },
};
class SigningCosmWasmClient extends cosmwasmclient_1.CosmWasmClient {
    /**
     * Creates a new client with signing capability to interact with a CosmWasm blockchain. This is the bigger brother of CosmWasmClient.
     *
     * This instance does a lot of caching. In order to benefit from that you should try to use one instance
     * for the lifetime of your application. When switching backends, a new instance must be created.
     *
     * @param apiUrl The URL of a Cosmos SDK light client daemon API (sometimes called REST server or REST API)
     * @param senderAddress The address that will sign and send transactions using this instance
     * @param signer An asynchronous callback to create a signature for a given transaction. This can be implemented using secure key stores that require user interaction. Or a newer OfflineSigner type that handles that stuff
     * @param seedOrEnigmaUtils
     * @param customFees The fees that are paid for transactions
     * @param broadcastMode Defines at which point of the transaction processing the postTx method (i.e. transaction broadcasting) returns
     */
    constructor(apiUrl, senderAddress, signer, seedOrEnigmaUtils, customFees, broadcastMode = restclient_1.BroadcastMode.Block) {
        if (seedOrEnigmaUtils instanceof Uint8Array) {
            super(apiUrl, seedOrEnigmaUtils, broadcastMode);
        }
        else {
            super(apiUrl, undefined, broadcastMode);
        }
        this.anyValidAddress = senderAddress;
        this.senderAddress = senderAddress;
        //this.signCallback = signCallback ? signCallback : undefined;
        this.signer = signer;
        if (seedOrEnigmaUtils && !(seedOrEnigmaUtils instanceof Uint8Array)) {
            this.restClient.enigmautils = seedOrEnigmaUtils;
        }
        this.fees = Object.assign(Object.assign({}, defaultFees), (customFees || {}));
    }
    async getNonce(address) {
        return super.getNonce(address || this.senderAddress);
    }
    async getAccount(address) {
        return super.getAccount(address || this.senderAddress);
    }
    async signAdapter(msgs, fee, chainId, memo, accountNumber, sequence) {
        // offline signer interface
        if ("sign" in this.signer) {
            const signResponse = await this.signer.sign(this.senderAddress, {
                chain_id: chainId,
                account_number: String(accountNumber),
                sequence: String(sequence),
                fee: fee,
                msgs: msgs,
                memo: memo,
            });
            return {
                msg: msgs,
                fee: signResponse.signed.fee,
                memo: signResponse.signed.memo,
                signatures: [signResponse.signature],
            };
        }
        else {
            // legacy interface
            const signBytes = encoding_2.makeSignBytes(msgs, fee, chainId, memo, accountNumber, sequence);
            const signature = await this.signer(signBytes);
            return {
                msg: msgs,
                fee: fee,
                memo: memo,
                signatures: [signature],
            };
        }
    }
    /** Uploads code and returns a receipt, including the code ID */
    async upload(wasmCode, meta = {}, memo = "") {
        const source = meta.source || "";
        const builder = prepareBuilder(meta.builder);
        const compressed = pako_1.default.gzip(wasmCode, { level: 9 });
        const storeCodeMsg = {
            type: "wasm/MsgStoreCode",
            value: {
                sender: this.senderAddress,
                // eslint-disable-next-line @typescript-eslint/camelcase
                wasm_byte_code: encoding_1.Encoding.toBase64(compressed),
                source: source,
                builder: builder,
            },
        };
        const fee = this.fees.upload;
        const { accountNumber, sequence } = await this.getNonce();
        const chainId = await this.getChainId();
        const signedTx = await this.signAdapter([storeCodeMsg], fee, chainId, memo, accountNumber, sequence);
        const result = await this.postTx(signedTx);
        const codeIdAttr = logs_1.findAttribute(result.logs, "message", "code_id");
        return {
            originalSize: wasmCode.length,
            originalChecksum: encoding_1.Encoding.toHex(new crypto_1.Sha256(wasmCode).digest()),
            compressedSize: compressed.length,
            compressedChecksum: encoding_1.Encoding.toHex(new crypto_1.Sha256(compressed).digest()),
            codeId: Number.parseInt(codeIdAttr.value, 10),
            logs: result.logs,
            transactionHash: result.transactionHash,
        };
    }
    async instantiate(codeId, initMsg, label, memo = "", transferAmount) {
        const contractCodeHash = await this.restClient.getCodeHashByCodeId(codeId);
        const instantiateMsg = {
            type: "wasm/MsgInstantiateContract",
            value: {
                sender: this.senderAddress,
                // eslint-disable-next-line @typescript-eslint/camelcase
                code_id: codeId.toString(),
                label: label,
                // eslint-disable-next-line @typescript-eslint/camelcase
                callback_code_hash: "",
                // eslint-disable-next-line @typescript-eslint/camelcase
                init_msg: encoding_1.Encoding.toBase64(await this.restClient.enigmautils.encrypt(contractCodeHash, initMsg)),
                // eslint-disable-next-line @typescript-eslint/camelcase
                init_funds: transferAmount || [],
                // eslint-disable-next-line @typescript-eslint/camelcase
                callback_sig: null,
            },
        };
        const fee = this.fees.init;
        const { accountNumber, sequence } = await this.getNonce();
        const chainId = await this.getChainId();
        const signedTx = await this.signAdapter([instantiateMsg], fee, chainId, memo, accountNumber, sequence);
        const result = await this.postTx(signedTx);
        const contractAddressAttr = logs_1.findAttribute(result.logs, "message", "contract_address");
        const nonce = encoding_1.Encoding.fromBase64(instantiateMsg.value.init_msg).slice(0, 32);
        const logs = await this.restClient.decryptLogs(result.logs, nonce);
        return {
            contractAddress: contractAddressAttr.value,
            logs: logs,
            transactionHash: result.transactionHash,
            data: result.data,
        };
    }
    async execute(contractAddress, handleMsg, memo = "", transferAmount) {
        const contractCodeHash = await this.restClient.getCodeHashByContractAddr(contractAddress);
        const executeMsg = {
            type: "wasm/MsgExecuteContract",
            value: {
                sender: this.senderAddress,
                contract: contractAddress,
                callback_code_hash: "",
                msg: encoding_1.Encoding.toBase64(await this.restClient.enigmautils.encrypt(contractCodeHash, handleMsg)),
                // eslint-disable-next-line @typescript-eslint/camelcase
                sent_funds: transferAmount || [],
                // eslint-disable-next-line @typescript-eslint/camelcase
                callback_sig: null,
            },
        };
        const fee = this.fees.exec;
        const { accountNumber, sequence } = await this.getNonce();
        const chainId = await this.getChainId();
        const signedTx = await this.signAdapter([executeMsg], fee, chainId, memo, accountNumber, sequence);
        const nonce = encoding_1.Encoding.fromBase64(executeMsg.value.msg).slice(0, 32);
        let result;
        try {
            result = await this.postTx(signedTx);
        }
        catch (err) {
            try {
                const errorMessageRgx = /contract failed: encrypted: (.+?): failed to execute message; message index: 0/g;
                const rgxMatches = errorMessageRgx.exec(err.message);
                if (rgxMatches == null || rgxMatches.length != 2) {
                    throw err;
                }
                const errorCipherB64 = rgxMatches[1];
                const errorCipherBz = encoding_1.Encoding.fromBase64(errorCipherB64);
                const errorPlainBz = await this.restClient.enigmautils.decrypt(errorCipherBz, nonce);
                err.message = err.message.replace(errorCipherB64, encoding_1.Encoding.fromUtf8(errorPlainBz));
            }
            catch (decryptionError) {
                throw new Error(`Failed to decrypt the following error message: ${err.message}. Decryption error of the error message: ${decryptionError.message}`);
            }
            throw err;
        }
        const data = await this.restClient.decryptDataField(result.data, nonce);
        const logs = await this.restClient.decryptLogs(result.logs, nonce);
        return {
            logs: logs,
            transactionHash: result.transactionHash,
            data: data,
        };
    }
    async sendTokens(recipientAddress, transferAmount, memo = "") {
        const sendMsg = {
            type: "cosmos-sdk/MsgSend",
            value: {
                // eslint-disable-next-line @typescript-eslint/camelcase
                from_address: this.senderAddress,
                // eslint-disable-next-line @typescript-eslint/camelcase
                to_address: recipientAddress,
                amount: transferAmount,
            },
        };
        const fee = this.fees.send;
        const { accountNumber, sequence } = await this.getNonce();
        const chainId = await this.getChainId();
        const signedTx = await this.signAdapter([sendMsg], fee, chainId, memo, accountNumber, sequence);
        return this.postTx(signedTx);
    }
}
exports.SigningCosmWasmClient = SigningCosmWasmClient;
//# sourceMappingURL=signingcosmwasmclient.js.map