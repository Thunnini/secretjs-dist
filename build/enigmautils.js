"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const miscreant = require("miscreant");
const curve25519_js_1 = require("curve25519-js");
const encoding_1 = require("@iov/encoding");
const secureRandom = require("secure-random");
const axios_1 = __importDefault(require("axios"));
const hkdf = require("js-crypto-hkdf");
const cryptoProvider = new miscreant.PolyfillCryptoProvider();
const hkdfSalt = Uint8Array.from([
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x02,
    0x4b,
    0xea,
    0xd8,
    0xdf,
    0x69,
    0x99,
    0x08,
    0x52,
    0xc2,
    0x02,
    0xdb,
    0x0e,
    0x00,
    0x97,
    0xc1,
    0xa1,
    0x2e,
    0xa6,
    0x37,
    0xd7,
    0xe9,
    0x6d,
]);
class EnigmaUtils {
    constructor(apiUrl, seed) {
        this.consensusIoPubKey = new Uint8Array(); // cache
        this.apiUrl = apiUrl;
        if (!seed) {
            this.seed = EnigmaUtils.GenerateNewSeed();
        }
        else {
            this.seed = seed;
        }
        const { privkey, pubkey } = EnigmaUtils.GenerateNewKeyPairFromSeed(this.seed);
        this.privkey = privkey;
        this.pubkey = pubkey;
    }
    static GenerateNewKeyPair() {
        return EnigmaUtils.GenerateNewKeyPairFromSeed(EnigmaUtils.GenerateNewSeed());
    }
    static GenerateNewSeed() {
        return secureRandom(32, { type: "Uint8Array" });
    }
    static GenerateNewKeyPairFromSeed(seed) {
        const { private: privkey, public: pubkey } = curve25519_js_1.generateKeyPair(seed);
        return { privkey, pubkey };
    }
    async getConsensusIoPubKey() {
        if (this.consensusIoPubKey.length === 32) {
            return this.consensusIoPubKey;
        }
        const { data: { result: { ioExchPubkey }, }, } = await axios_1.default.get(this.apiUrl + "/reg/consensus-io-exch-pubkey", {
            headers: { "Content-Type": "application/json" },
        });
        this.consensusIoPubKey = encoding_1.Encoding.fromBase64(ioExchPubkey);
        return this.consensusIoPubKey;
    }
    async getTxEncryptionKey(txSenderPrivKey, nonce) {
        const consensusIoPubKey = await this.getConsensusIoPubKey();
        const txEncryptionIkm = curve25519_js_1.sharedKey(txSenderPrivKey, consensusIoPubKey);
        const { key: txEncryptionKey } = await hkdf.compute(Uint8Array.from([...txEncryptionIkm, ...nonce]), "SHA-256", 32, "", hkdfSalt);
        return txEncryptionKey;
    }
    async encrypt(contractCodeHash, msg) {
        const nonce = secureRandom(32, {
            type: "Uint8Array",
        });
        const txEncryptionKey = await this.getTxEncryptionKey(this.privkey, nonce);
        const siv = await miscreant.SIV.importKey(txEncryptionKey, "AES-SIV", cryptoProvider);
        const plaintext = encoding_1.Encoding.toUtf8(contractCodeHash + JSON.stringify(msg));
        const ciphertext = await siv.seal(plaintext, [new Uint8Array()]);
        // ciphertext = nonce(32) || wallet_pubkey(32) || ciphertext
        return Uint8Array.from([...nonce, ...this.pubkey, ...ciphertext]);
    }
    async decrypt(ciphertext, nonce) {
        if (ciphertext.length === 0) {
            return new Uint8Array();
        }
        const txEncryptionKey = await this.getTxEncryptionKey(this.privkey, nonce);
        const siv = await miscreant.SIV.importKey(txEncryptionKey, "AES-SIV", cryptoProvider);
        const plaintext = await siv.open(ciphertext, [new Uint8Array()]);
        return plaintext;
    }
    getPubkey() {
        return Promise.resolve(this.pubkey);
    }
}
exports.default = EnigmaUtils;
module.exports = EnigmaUtils;
//# sourceMappingURL=enigmautils.js.map