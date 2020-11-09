export declare function getHackatom(): Uint8Array;
export declare function makeRandomAddress(): string;
export declare const nonNegativeIntegerMatcher: RegExp;
export declare const tendermintIdMatcher: RegExp;
export declare const tendermintOptionalIdMatcher: RegExp;
export declare const tendermintAddressMatcher: RegExp;
export declare const tendermintShortHashMatcher: RegExp;
export declare const semverMatcher: RegExp;
export declare const bech32AddressMatcher: RegExp;
/** Deployed as part of scripts/wasmd/init.sh */
export declare const deployedErc20: {
    codeId: number;
    source: string;
    builder: string;
    checksum: string;
    instances: string[];
};
export declare const wasmd: {
    endpoint: string;
    chainId: string;
};
export declare const faucet: {
    mnemonic: string;
    pubkey: {
        type: string;
        value: string;
    };
    address: string;
};
/** Unused account */
export declare const unused: {
    pubkey: {
        type: string;
        value: string;
    };
    address: string;
    accountNumber: number;
    sequence: number;
};
export declare function wasmdEnabled(): boolean;
export declare function pendingWithoutWasmd(): void;
/** Returns first element. Throws if array has a different length than 1. */
export declare function fromOneElementArray<T>(elements: ArrayLike<T>): T;
