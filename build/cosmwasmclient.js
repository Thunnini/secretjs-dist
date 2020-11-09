"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("@iov/crypto");
const encoding_1 = require("@iov/encoding");
const logs_1 = require("./logs");
const pubkey_1 = require("./pubkey");
const restclient_1 = require("./restclient");
function isSearchByIdQuery(query) {
    return query.id !== undefined;
}
function isSearchByHeightQuery(query) {
    return query.height !== undefined;
}
function isSearchBySentFromOrToQuery(query) {
    return query.sentFromOrTo !== undefined;
}
function isSearchByTagsQuery(query) {
    return query.tags !== undefined;
}
class CosmWasmClient {
    /**
     * Creates a new client to interact with a CosmWasm blockchain.
     *
     * This instance does a lot of caching. In order to benefit from that you should try to use one instance
     * for the lifetime of your application. When switching backends, a new instance must be created.
     *
     * @param apiUrl The URL of a Cosmos SDK light client daemon API (sometimes called REST server or REST API)
     * @param broadcastMode Defines at which point of the transaction processing the postTx method (i.e. transaction broadcasting) returns
     */
    constructor(apiUrl, seed, broadcastMode = restclient_1.BroadcastMode.Block) {
        this.codesCache = new Map();
        this.restClient = new restclient_1.RestClient(apiUrl, broadcastMode, seed);
    }
    async getChainId() {
        if (!this.chainId) {
            const response = await this.restClient.nodeInfo();
            const chainId = response.node_info.network;
            if (!chainId)
                throw new Error("Chain ID must not be empty");
            this.chainId = chainId;
        }
        return this.chainId;
    }
    async getHeight() {
        if (this.anyValidAddress) {
            const { height } = await this.restClient.authAccounts(this.anyValidAddress);
            return parseInt(height, 10);
        }
        else {
            // Note: this gets inefficient when blocks contain a lot of transactions since it
            // requires downloading and deserializing all transactions in the block.
            const latest = await this.restClient.blocksLatest();
            return parseInt(latest.block.header.height, 10);
        }
    }
    /**
     * Returns a 32 byte upper-case hex transaction hash (typically used as the transaction ID)
     */
    async getIdentifier(tx) {
        // We consult the REST API because we don't have a local amino encoder
        const bytes = await this.restClient.encodeTx(tx);
        const hash = new crypto_1.Sha256(bytes).digest();
        return encoding_1.Encoding.toHex(hash).toUpperCase();
    }
    /**
     * Returns account number and sequence.
     *
     * Throws if the account does not exist on chain.
     *
     * @param address returns data for this address. When unset, the client's sender adddress is used.
     */
    async getNonce(address) {
        const account = await this.getAccount(address);
        if (!account) {
            throw new Error("Account does not exist on chain. Send some tokens there before trying to query nonces.");
        }
        return {
            accountNumber: account.accountNumber,
            sequence: account.sequence,
        };
    }
    async getAccount(address) {
        const account = await this.restClient.authAccounts(address);
        const value = account.result.value;
        if (value.address === "") {
            return undefined;
        }
        else {
            this.anyValidAddress = value.address;
            return {
                address: value.address,
                balance: value.coins,
                pubkey: value.public_key ? pubkey_1.decodeBech32Pubkey(value.public_key) : undefined,
                accountNumber: value.account_number,
                sequence: value.sequence,
            };
        }
    }
    /**
     * Gets block header and meta
     *
     * @param height The height of the block. If undefined, the latest height is used.
     */
    async getBlock(height) {
        const response = height !== undefined ? await this.restClient.blocks(height) : await this.restClient.blocksLatest();
        return {
            id: response.block_id.hash,
            header: {
                version: response.block.header.version,
                time: response.block.header.time,
                height: parseInt(response.block.header.height, 10),
                chainId: response.block.header.chain_id,
            },
            txs: (response.block.data.txs || []).map((encoded) => encoding_1.Encoding.fromBase64(encoded)),
        };
    }
    async searchTx(query, filter = {}) {
        const minHeight = filter.minHeight || 0;
        const maxHeight = filter.maxHeight || Number.MAX_SAFE_INTEGER;
        if (maxHeight < minHeight)
            return []; // optional optimization
        function withFilters(originalQuery) {
            return `${originalQuery}&tx.minheight=${minHeight}&tx.maxheight=${maxHeight}`;
        }
        let txs;
        if (isSearchByIdQuery(query)) {
            txs = await this.txsQuery(`tx.hash=${query.id}`);
        }
        else if (isSearchByHeightQuery(query)) {
            // optional optimization to avoid network request
            if (query.height < minHeight || query.height > maxHeight) {
                txs = [];
            }
            else {
                txs = await this.txsQuery(`tx.height=${query.height}`);
            }
        }
        else if (isSearchBySentFromOrToQuery(query)) {
            // We cannot get both in one request (see https://github.com/cosmos/gaia/issues/75)
            const sentQuery = withFilters(`message.module=bank&message.sender=${query.sentFromOrTo}`);
            const receivedQuery = withFilters(`message.module=bank&transfer.recipient=${query.sentFromOrTo}`);
            const sent = await this.txsQuery(sentQuery);
            const received = await this.txsQuery(receivedQuery);
            const sentHashes = sent.map((t) => t.hash);
            txs = [...sent, ...received.filter((t) => !sentHashes.includes(t.hash))];
        }
        else if (isSearchByTagsQuery(query)) {
            const rawQuery = withFilters(query.tags.map((t) => `${t.key}=${t.value}`).join("&"));
            txs = await this.txsQuery(rawQuery);
        }
        else {
            throw new Error("Unknown query type");
        }
        // backend sometimes messes up with min/max height filtering
        const filtered = txs.filter((tx) => tx.height >= minHeight && tx.height <= maxHeight);
        return filtered;
    }
    async postTx(tx) {
        const result = await this.restClient.postTx(tx);
        if (!result.txhash.match(/^([0-9A-F][0-9A-F])+$/)) {
            throw new Error("Received ill-formatted txhash. Must be non-empty upper-case hex");
        }
        if (result.code) {
            throw new Error(`Error when posting tx ${result.txhash}. Code: ${result.code}; Raw log: ${result.raw_log}`);
        }
        return {
            logs: result.logs ? logs_1.parseLogs(result.logs) : [],
            rawLog: result.raw_log || "",
            transactionHash: result.txhash,
            data: result.data || "",
        };
    }
    async getCodes() {
        const result = await this.restClient.listCodeInfo();
        return result.map((entry) => {
            this.anyValidAddress = entry.creator;
            return {
                id: entry.id,
                creator: entry.creator,
                checksum: encoding_1.Encoding.toHex(encoding_1.Encoding.fromHex(entry.data_hash)),
                source: entry.source || undefined,
                builder: entry.builder || undefined,
            };
        });
    }
    async getCodeDetails(codeId) {
        const cached = this.codesCache.get(codeId);
        if (cached)
            return cached;
        const getCodeResult = await this.restClient.getCode(codeId);
        const codeDetails = {
            id: getCodeResult.id,
            creator: getCodeResult.creator,
            checksum: encoding_1.Encoding.toHex(encoding_1.Encoding.fromHex(getCodeResult.data_hash)),
            source: getCodeResult.source || undefined,
            builder: getCodeResult.builder || undefined,
            data: encoding_1.Encoding.fromBase64(getCodeResult.data),
        };
        this.codesCache.set(codeId, codeDetails);
        return codeDetails;
    }
    async getContracts(codeId) {
        const result = await this.restClient.listContractsByCodeId(codeId);
        return result.map((entry) => ({
            address: entry.address,
            codeId: entry.code_id,
            creator: entry.creator,
            label: entry.label,
        }));
    }
    /**
     * Throws an error if no contract was found at the address
     */
    async getContract(address) {
        const result = await this.restClient.getContractInfo(address);
        if (!result)
            throw new Error(`No contract found at address "${address}"`);
        return {
            address: result.address,
            codeId: result.code_id,
            creator: result.creator,
            label: result.label,
            initMsg: result.init_msg,
        };
    }
    /**
     * Returns the data at the key if present (raw contract dependent storage data)
     * or null if no data at this key.
     *
     * Promise is rejected when contract does not exist.
     */
    async queryContractRaw(address, key) {
        // just test contract existence
        const _info = await this.getContract(address);
        return this.restClient.queryContractRaw(address, key);
    }
    /**
     * Makes a smart query on the contract, returns the parsed JSON document.
     *
     * Promise is rejected when contract does not exist.
     * Promise is rejected for invalid query format.
     * Promise is rejected for invalid response format.
     */
    async queryContractSmart(address, queryMsg) {
        try {
            return await this.restClient.queryContractSmart(address, queryMsg);
        }
        catch (error) {
            if (error instanceof Error) {
                if (error.message.startsWith("not found: contract")) {
                    throw new Error(`No contract found at address "${address}"`);
                }
                else {
                    throw error;
                }
            }
            else {
                throw error;
            }
        }
    }
    async txsQuery(query) {
        // TODO: we need proper pagination support
        const limit = 100;
        const result = await this.restClient.txsQuery(`${query}&limit=${limit}`);
        const pages = parseInt(result.page_total, 10);
        if (pages > 1) {
            throw new Error(`Found more results on the backend than we can process currently. Results: ${result.total_count}, supported: ${limit}`);
        }
        return result.txs.map((restItem) => ({
            height: parseInt(restItem.height, 10),
            hash: restItem.txhash,
            code: restItem.code || 0,
            rawLog: restItem.raw_log,
            logs: logs_1.parseLogs(restItem.logs || []),
            tx: restItem.tx,
            timestamp: restItem.timestamp,
        }));
    }
    getCodeHashByCodeId(id) {
        return this.restClient.getCodeHashByCodeId(id);
    }
    getCodeHashByContractAddr(addr) {
        return this.restClient.getCodeHashByContractAddr(addr);
    }
}
exports.CosmWasmClient = CosmWasmClient;
//# sourceMappingURL=cosmwasmclient.js.map