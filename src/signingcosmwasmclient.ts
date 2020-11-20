import { Sha256 } from "@iov/crypto";
import { Encoding } from "@iov/encoding";
import pako from "pako";

import { isValidBuilder } from "./builder";
import { Account, CosmWasmClient, GetNonceResult, PostTxResult } from "./cosmwasmclient";
import { makeSignBytes } from "./encoding";
import { SecretUtils } from "./enigmautils";
import { findAttribute, Log } from "./logs";
import { BroadcastMode } from "./restclient";
import {
  Coin,
  Msg,
  MsgExecuteContract,
  MsgInstantiateContract,
  MsgSend,
  MsgStoreCode,
  StdFee,
  StdSignature,
  StdTx,
} from "./types";
import { OfflineSigner } from "./wallet";

export interface SigningCallback {
  (signBytes: Uint8Array): Promise<StdSignature>;
}

export interface FeeTable {
  readonly upload: StdFee;
  readonly init: StdFee;
  readonly exec: StdFee;
  readonly send: StdFee;
}

function singleAmount(amount: number, denom: string): readonly Coin[] {
  return [{ amount: amount.toString(), denom: denom }];
}

function prepareBuilder(buider: string | undefined): string {
  if (buider === undefined) {
    return ""; // normalization needed by backend
  } else {
    if (!isValidBuilder(buider)) throw new Error("The builder (Docker Hub image with tag) is not valid");
    return buider;
  }
}

const defaultFees: FeeTable = {
  upload: {
    amount: singleAmount(25000, "ucosm"),
    gas: "1000000", // one million
  },
  init: {
    amount: singleAmount(12500, "ucosm"),
    gas: "500000", // 500k
  },
  exec: {
    amount: singleAmount(5000, "ucosm"),
    gas: "200000", // 200k
  },
  send: {
    amount: singleAmount(2000, "ucosm"),
    gas: "80000", // 80k
  },
};

export interface UploadMeta {
  /** The source URL */
  readonly source?: string;
  /** The builder tag */
  readonly builder?: string;
}

export interface UploadResult {
  /** Size of the original wasm code in bytes */
  readonly originalSize: number;
  /** A hex encoded sha256 checksum of the original wasm code (that is stored on chain) */
  readonly originalChecksum: string;
  /** Size of the compressed wasm code in bytes */
  readonly compressedSize: number;
  /** A hex encoded sha256 checksum of the compressed wasm code (that stored in the transaction) */
  readonly compressedChecksum: string;
  /** The ID of the code asigned by the chain */
  readonly codeId: number;
  readonly logs: readonly Log[];
  /** Transaction hash (might be used as transaction ID). Guaranteed to be non-empty upper-case hex */
  readonly transactionHash: string;
}

export interface InstantiateResult {
  /** The address of the newly instantiated contract */
  readonly contractAddress: string;
  readonly logs: readonly Log[];
  /** Transaction hash (might be used as transaction ID). Guaranteed to be non-empty upper-case hex */
  readonly transactionHash: string;
  readonly data: any;
}

export interface ExecuteResult {
  readonly logs: readonly Log[];
  /** Transaction hash (might be used as transaction ID). Guaranteed to be non-empty upper-case hex */
  readonly transactionHash: string;
  readonly data: any;
}

export class SigningCosmWasmClient extends CosmWasmClient {
  public readonly senderAddress: string;
  private readonly signer: OfflineSigner | SigningCallback;
  private readonly fees: FeeTable;

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
  public constructor(
    apiUrl: string,
    senderAddress: string,
    signer: SigningCallback | OfflineSigner,
    seedOrEnigmaUtils?: Uint8Array | SecretUtils,
    customFees?: Partial<FeeTable>,
    broadcastMode = BroadcastMode.Block,
  ) {
    if (seedOrEnigmaUtils instanceof Uint8Array) {
      super(apiUrl, seedOrEnigmaUtils, broadcastMode);
    } else {
      super(apiUrl, undefined, broadcastMode);
    }

    this.anyValidAddress = senderAddress;
    this.senderAddress = senderAddress;
    //this.signCallback = signCallback ? signCallback : undefined;
    this.signer = signer;
    if (seedOrEnigmaUtils && !(seedOrEnigmaUtils instanceof Uint8Array)) {
      this.restClient.enigmautils = seedOrEnigmaUtils;
    }
    this.fees = { ...defaultFees, ...(customFees || {}) };
  }

  public async getNonce(address?: string): Promise<GetNonceResult> {
    return super.getNonce(address || this.senderAddress);
  }

  public async getAccount(address?: string): Promise<Account | undefined> {
    return super.getAccount(address || this.senderAddress);
  }

  async signAdapter(
    msgs: Msg[],
    fee: StdFee,
    chainId: string,
    memo: string,
    accountNumber: number,
    sequence: number,
  ): Promise<StdTx> {
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
    } else {
      // legacy interface
      const signBytes = makeSignBytes(msgs, fee, chainId, memo, accountNumber, sequence);
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
  public async upload(wasmCode: Uint8Array, meta: UploadMeta = {}, memo = ""): Promise<UploadResult> {
    const source = meta.source || "";
    const builder = prepareBuilder(meta.builder);

    const compressed = pako.gzip(wasmCode, { level: 9 });
    const storeCodeMsg: MsgStoreCode = {
      type: "wasm/MsgStoreCode",
      value: {
        sender: this.senderAddress,
        // eslint-disable-next-line @typescript-eslint/camelcase
        wasm_byte_code: Encoding.toBase64(compressed),
        source: source,
        builder: builder,
      },
    };
    const fee = this.fees.upload;
    const { accountNumber, sequence } = await this.getNonce();
    const chainId = await this.getChainId();
    const signedTx = await this.signAdapter([storeCodeMsg], fee, chainId, memo, accountNumber, sequence);

    const result = await this.postTx(signedTx);
    const codeIdAttr = findAttribute(result.logs, "message", "code_id");
    return {
      originalSize: wasmCode.length,
      originalChecksum: Encoding.toHex(new Sha256(wasmCode).digest()),
      compressedSize: compressed.length,
      compressedChecksum: Encoding.toHex(new Sha256(compressed).digest()),
      codeId: Number.parseInt(codeIdAttr.value, 10),
      logs: result.logs,
      transactionHash: result.transactionHash,
    };
  }

  public async instantiate(
    codeId: number,
    initMsg: object,
    label: string,
    memo = "",
    transferAmount?: readonly Coin[],
  ): Promise<InstantiateResult> {
    const contractCodeHash = await this.restClient.getCodeHashByCodeId(codeId);
    const instantiateMsg: MsgInstantiateContract = {
      type: "wasm/MsgInstantiateContract",
      value: {
        sender: this.senderAddress,
        // eslint-disable-next-line @typescript-eslint/camelcase
        code_id: codeId.toString(),
        label: label,
        // eslint-disable-next-line @typescript-eslint/camelcase
        callback_code_hash: "",
        // eslint-disable-next-line @typescript-eslint/camelcase
        init_msg: Encoding.toBase64(await this.restClient.enigmautils.encrypt(contractCodeHash, initMsg)),
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
    const contractAddressAttr = findAttribute(result.logs, "message", "contract_address");

    const nonce = Encoding.fromBase64(instantiateMsg.value.init_msg).slice(0, 32);

    const logs = await this.restClient.decryptLogs(result.logs, nonce);

    return {
      contractAddress: contractAddressAttr.value,
      logs: logs,
      transactionHash: result.transactionHash,
      data: result.data, // data is the address of the new contract, so nothing to decrypt
    };
  }

  public async execute(
    contractAddress: string,
    handleMsg: object,
    memo = "",
    transferAmount?: readonly Coin[],
  ): Promise<ExecuteResult> {
    const contractCodeHash = await this.restClient.getCodeHashByContractAddr(contractAddress);

    const executeMsg: MsgExecuteContract = {
      type: "wasm/MsgExecuteContract",
      value: {
        sender: this.senderAddress,
        contract: contractAddress,
        callback_code_hash: "",
        msg: Encoding.toBase64(await this.restClient.enigmautils.encrypt(contractCodeHash, handleMsg)),
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

    const nonce = Encoding.fromBase64(executeMsg.value.msg).slice(0, 32);
    let result;
    try {
      result = await this.postTx(signedTx);
    } catch (err) {
      try {
        const errorMessageRgx = /contract failed: encrypted: (.+?): failed to execute message; message index: 0/g;

        const rgxMatches = errorMessageRgx.exec(err.message);
        if (rgxMatches == null || rgxMatches.length != 2) {
          throw err;
        }

        const errorCipherB64 = rgxMatches[1];
        const errorCipherBz = Encoding.fromBase64(errorCipherB64);

        const errorPlainBz = await this.restClient.enigmautils.decrypt(errorCipherBz, nonce);

        err.message = err.message.replace(errorCipherB64, Encoding.fromUtf8(errorPlainBz));
      } catch (decryptionError) {
        throw new Error(
          `Failed to decrypt the following error message: ${err.message}. Decryption error of the error message: ${decryptionError.message}`,
        );
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

  public async sendTokens(
    recipientAddress: string,
    transferAmount: readonly Coin[],
    memo = "",
  ): Promise<PostTxResult> {
    const sendMsg: MsgSend = {
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
