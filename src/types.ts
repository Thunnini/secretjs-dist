import { Encoding } from "@iov/encoding";

const { fromBase64, fromHex } = Encoding;

/** An Amino/Cosmos SDK StdTx */
export interface StdTx {
  msg: Msg[];
  readonly fee: StdFee;
  readonly signatures: ReadonlyArray<StdSignature>;
  readonly memo: string | undefined;
}

export function isStdTx(txValue: unknown): txValue is StdTx {
  const { memo, msg, fee, signatures } = txValue as StdTx;
  return (
    typeof memo === "string" && Array.isArray(msg) && typeof fee === "object" && Array.isArray(signatures)
  );
}

export interface CosmosSdkTx {
  readonly type: string;
  readonly value: StdTx;
}

interface MsgTemplate {
  readonly type: string;
  readonly value: any;
}

/** A Cosmos SDK token transfer message */
export interface MsgSend extends MsgTemplate {
  readonly type: "cosmos-sdk/MsgSend";
  readonly value: {
    /** Bech32 account address */
    readonly from_address: string;
    /** Bech32 account address */
    readonly to_address: string;
    readonly amount: ReadonlyArray<Coin>;
  };
}

/**
 * Uploads Wam code to the chain
 *
 * @see https://github.com/cosmwasm/wasmd/blob/9842678d89/x/wasm/internal/types/msg.go#L17
 */
export interface MsgStoreCode extends MsgTemplate {
  readonly type: "wasm/MsgStoreCode";
  readonly value: {
    /** Bech32 account address */
    readonly sender: string;
    /** Base64 encoded Wasm */
    readonly wasm_byte_code: string;
    /** A valid URI reference to the contract's source code. Can be empty. */
    readonly source: string;
    /** A docker tag. Can be empty. */
    readonly builder: string;
  };
}

/**
 * Creates an instance of contract that was uploaded before.
 *
 * @see https://github.com/cosmwasm/wasmd/blob/9842678d89/x/wasm/internal/types/msg.go#L73
 */
export interface MsgInstantiateContract extends MsgTemplate {
  readonly type: "wasm/MsgInstantiateContract";
  readonly value: {
    /** Bech32 account address */
    readonly sender: string;
    /** ID of the Wasm code that was uploaded before */
    readonly code_id: string;
    /** Human-readable label for this contract */
    readonly label: string;
    /** callback_code_hash should always be an empty string when coming from the user */
    readonly callback_code_hash: string;
    /** Init message as JavaScript object */
    init_msg: any;
    readonly init_funds: ReadonlyArray<Coin>;
    readonly callback_sig: any;
  };
}

/**
 * Creates an instance of contract that was uploaded before.
 *
 * @see https://github.com/cosmwasm/wasmd/blob/9842678d89/x/wasm/internal/types/msg.go#L103
 */
export interface MsgExecuteContract extends MsgTemplate {
  readonly type: "wasm/MsgExecuteContract";
  readonly value: {
    /** Bech32 account address */
    readonly sender: string;
    /** Bech32 account address */
    readonly contract: string;
    /** callback_code_hash should always be an empty string when coming from the user */
    readonly callback_code_hash: string;
    /** Handle message as JavaScript object */
    msg: any;
    readonly sent_funds: ReadonlyArray<Coin>;
    readonly callback_sig: any;
  };
}

export type Msg = MsgSend | MsgStoreCode | MsgInstantiateContract | MsgExecuteContract | MsgTemplate;

export function isMsgSend(msg: Msg): msg is MsgSend {
  return (msg as MsgSend).type === "cosmos-sdk/MsgSend";
}

export function isMsgStoreCode(msg: Msg): msg is MsgStoreCode {
  return (msg as MsgStoreCode).type === "wasm/MsgStoreCode";
}

export function isMsgInstantiateContract(msg: Msg): msg is MsgInstantiateContract {
  return (msg as MsgInstantiateContract).type === "wasm/MsgInstantiateContract";
}

export function isMsgExecuteContract(msg: Msg): msg is MsgExecuteContract {
  return (msg as MsgExecuteContract).type === "wasm/MsgExecuteContract";
}

export interface StdFee {
  readonly amount: ReadonlyArray<Coin>;
  readonly gas: string;
}

export interface Coin {
  readonly denom: string;
  readonly amount: string;
}

export interface StdSignature {
  readonly pub_key: PubKey;
  readonly signature: string;
}

export interface PubKey {
  // type is one of the strings defined in pubkeyTypes
  // I don't use a string literal union here as that makes trouble with json test data:
  // https://github.com/confio/cosmwasm-js/pull/44#pullrequestreview-353280504
  readonly type: string;
  // Value field is base64-encoded in all cases
  // Note: if type is Secp256k1, this must contain a COMPRESSED pubkey - to encode from bcp/keycontrol land, you must compress it first
  readonly value: string;
}

export const pubkeyType = {
  /** @see https://github.com/tendermint/tendermint/blob/v0.33.0/crypto/ed25519/ed25519.go#L22 */
  secp256k1: "tendermint/PubKeySecp256k1" as const,
  /** @see https://github.com/tendermint/tendermint/blob/v0.33.0/crypto/secp256k1/secp256k1.go#L23 */
  ed25519: "tendermint/PubKeyEd25519" as const,
  /** @see https://github.com/tendermint/tendermint/blob/v0.33.0/crypto/sr25519/codec.go#L12 */
  sr25519: "tendermint/PubKeySr25519" as const,
};

export const pubkeyTypes: readonly string[] = [pubkeyType.secp256k1, pubkeyType.ed25519, pubkeyType.sr25519];

export interface WasmData {
  // key is hex-encoded
  readonly key: string;
  // value is base64 encoded
  readonly val: string;
}

// Model is a parsed WasmData object
export interface Model {
  readonly key: Uint8Array;
  readonly val: Uint8Array;
}

export function parseWasmData({ key, val }: WasmData): Model {
  return {
    key: fromHex(key),
    val: fromBase64(val),
  };
}

/**
 * An object containing a parsed JSON document. The result of JSON.parse().
 * This doen't privide any type safety over `any` but expresses intent in the code.
 */
export type JsonObject = any;
